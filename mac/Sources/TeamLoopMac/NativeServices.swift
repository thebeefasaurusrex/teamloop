import AppKit
import Foundation
import Security
import ServiceManagement

enum SecretStore {
    private static let service = "io.github.thebeefasaurusrex.teamloop.mac"
    static func set(_ key: String, value: String) throws {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key]
        if value.isEmpty { let status = SecItemDelete(query as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { throw failure(status) }; return }
        let data = Data(value.utf8)
        let status = SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let inserted = SecItemAdd(add as CFDictionary,nil)
            guard inserted == errSecSuccess else { throw failure(inserted) }
        } else if status != errSecSuccess { throw failure(status) }
    }
    static func get(_ key: String) throws -> String? {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary,&result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, let value = String(data:data,encoding:.utf8) else { throw failure(status) }
        return value
    }
    private static func failure(_ status: OSStatus) -> NativeFailure { .message("Keychain access failed (\(status)). Unlock the login Keychain and retry; existing entries were not replaced.") }
}

@MainActor
final class AwakeController {
    private var activity: NSObjectProtocol?
    var isActive: Bool { activity != nil }
    func setEnabled(_ enabled: Bool) {
        if enabled && activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(options:[.idleSystemSleepDisabled],reason:"TeamLoop monitoring and tasks")
        } else if !enabled, let token = activity {
            ProcessInfo.processInfo.endActivity(token)
            activity = nil
        }
    }
    func stop() { setEnabled(false) }
}

enum LoginService {
    @MainActor static func openSettings() { SMAppService.openSystemSettingsLoginItems() }
    @MainActor static func update(_ enabled: Bool) throws {
        if enabled { try SMAppService.mainApp.register() }
        else { try SMAppService.mainApp.unregister() }
    }
    static var statusText: String {
        switch SMAppService.mainApp.status {
        case .enabled: return "Enabled"
        case .requiresApproval: return "Approval needed in System Settings"
        case .notRegistered: return "Off"
        case .notFound: return "Install the built app in Applications"
        @unknown default: return "Unknown"
        }
    }
}

enum ProviderSetup {
    static let pages: [String:String] = [
        "codex":"https://learn.chatgpt.com/docs/cli",
        "claude":"https://code.claude.com/docs/en/setup",
        "gemini":"https://antigravity.google/docs/getting-started?tab=cli",
        "codexbar":"https://github.com/steipete/CodexBar/releases/latest",
        "deepseek":"https://platform.deepseek.com/api_keys",
        "nvidia":"https://build.nvidia.com/"
    ]
    @MainActor static func openInstall(_ provider: String) {
        if let value = pages[provider], let url = URL(string:value) { NSWorkspace.shared.open(url) }
    }
    @MainActor static func openSignup(_ provider: String) {
        if let guide = EnrollmentGuide.subscription(provider), let url = URL(string:guide.signupURL) { NSWorkspace.shared.open(url) }
    }
    @MainActor static func openPricing(_ provider: String) {
        if let guide = EnrollmentGuide.subscription(provider), let url = URL(string:guide.pricingURL) { NSWorkspace.shared.open(url) }
    }
    @MainActor static func openGoogleDesktop() {
        if let url = URL(string:EnrollmentGuide.googleDesktopURL) { NSWorkspace.shared.open(url) }
    }
    static func installerCommand(_ provider: String) -> String? {
        switch provider {
        case "codex": return "/usr/bin/curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' 'https://chatgpt.com/codex/install.sh' | /bin/sh"
        case "claude": return "/usr/bin/curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' 'https://claude.ai/install.sh' | /bin/bash"
        case "gemini": return "/usr/bin/curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' 'https://antigravity.google/cli/install.sh' | /bin/bash"
        default: return nil
        }
    }
    /// User-triggered official installers only; no secret input or arbitrary commands.
    @MainActor static func install(_ provider: String) throws {
        guard let command = installerCommand(provider) else { openInstall(provider); return }
        try terminal(command)
    }
    @MainActor static func login(_ provider: String, path: String) throws {
        guard NSString(string:path).isAbsolutePath, FileManager.default.isExecutableFile(atPath:path), !path.contains("\n"), !path.contains("\r") else {
            throw NativeFailure.message("Locate the installed official tool first, then sign in.")
        }
        let args: [String]
        switch provider {
        case "codex": args = ["login"]
        case "claude": args = ["auth","login"]
        case "gemini": args = []
        default: throw NativeFailure.message("This provider uses an API key rather than browser sign-in.")
        }
        let clean = "/usr/bin/env -i HOME=" + ShellText.quote(FileManager.default.homeDirectoryForCurrentUser.path) + " PATH='/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin' TMPDIR=" + ShellText.quote(NSTemporaryDirectory()) + " LANG='en_US.UTF-8' "
        let setupFolder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/TeamLoop/setup",isDirectory:true)
        try FileManager.default.createDirectory(at:setupFolder,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        let command = "cd " + ShellText.quote(setupFolder.path) + " && " + clean + ([path] + args).map(ShellText.quote).joined(separator:" ")
        try terminal(command)
    }
    @MainActor private static func terminal(_ command: String) throws {
        let clean = "/usr/bin/env -i HOME=" + ShellText.quote(FileManager.default.homeDirectoryForCurrentUser.path) + " PATH='/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin' TMPDIR=" + ShellText.quote(NSTemporaryDirectory()) + " LANG='en_US.UTF-8' /bin/bash -o pipefail -c " + ShellText.quote(command)
        let source = "tell application \"Terminal\"\nactivate\ndo script " + ShellText.appleScript(clean) + "\nend tell"
        guard let script = NSAppleScript(source:source) else { throw NativeFailure.message("Could not prepare the official installer/login window.") }
        var error: NSDictionary?
        script.executeAndReturnError(&error)
        if error != nil { throw NativeFailure.message("Allow TeamLoop to open Terminal for this user-requested setup step, then retry.") }
    }
}
