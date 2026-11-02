import AppKit
import Foundation
import UserNotifications
import Combine
import Network

@MainActor
final class AppModel: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    @Published var settings = AppSettings()
    @Published var snapshot: CoreSnapshot?
    @Published var isWorking = false
    @Published var isRunningTask = false
    @Published var isRefreshing = false
    @Published var message = "Starting TeamLoop…"
    @Published var error: String?
    @Published var notificationStatus = "Not checked"
    @Published var loginStatus = LoginService.statusText
    @Published var keepAwakeActive = false
    @Published var diagnosticText = ""
    private let bridge = CoreBridge()
    private let awake = AwakeController()
    private var timer: Timer?
    private var operation: Task<Void,Never>?
    private var refreshOperation: Task<Void,Never>?
    private var notificationInFlight = Set<String>()
    private let networkMonitor = NWPathMonitor()
    private var wakeObserver: NSObjectProtocol?
    private var activeObserver: NSObjectProtocol?
    private var lastForegroundRefresh = Date.distantPast
    private var delivered = Set(UserDefaults.standard.stringArray(forKey:"acceptedLocalEvents") ?? [])
    private var refreshedOnce = false
    private var shuttingDown = false
    private var savedSettings: AppSettings { snapshot?.settings ?? settings }
    var hasUnsavedSettings: Bool { snapshot.map { $0.settings != settings } ?? false }

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(forName:NSWorkspace.didWakeNotification,object:nil,queue:.main) { [weak self] _ in
            Task { @MainActor [weak self] in guard let self, self.savedSettings.monitoringEnabled else { return }; self.refresh() }
        }
        activeObserver = NotificationCenter.default.addObserver(forName:NSApplication.didBecomeActiveNotification,object:nil,queue:.main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, Date().timeIntervalSince(self.lastForegroundRefresh) > 5 else { return }
                self.lastForegroundRefresh = Date()
                if self.snapshot == nil { self.start() } else { self.refresh() }
            }
        }
        networkMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor [weak self] in guard let self, self.savedSettings.monitoringEnabled else { return }; self.refresh() }
        }
        networkMonitor.start(queue:DispatchQueue(label:"io.github.thebeefasaurusrex.teamloop.connectivity"))
        Task { @MainActor [weak self] in self?.start() }
    }
    func start() {
        guard !shuttingDown, operation == nil, snapshot == nil else { return }
        perform("snapshot")
        Task { await updateNotificationStatus() }
    }
    func refresh() {
        guard !shuttingDown, !isRefreshing, !isWorking || isRunningTask else { return }
        let activeSettings = savedSettings
        isRefreshing = true
        refreshOperation = Task {
            defer { isRefreshing = false; refreshOperation = nil }
            do {
                let request: [String:Any] = ["secrets":try secrets(SecretSelection.names(action:"refresh",providers:[],enabled:activeSettings.enabledProviders))]
                let data = try await bridge.request("refresh",payload:request,timeout:180)
                try Task.checkCancellation()
                apply(try JSONDecoder().decode(CoreSnapshot.self,from:data))
                await publishPendingNotifications()
                if savedSettings.emailEnabled {
                    let mail = try await bridge.request("deliver",payload:["secrets":try secrets(["relay"])],timeout:90)
                    if let state = try? JSONDecoder().decode(CoreSnapshot.self,from:mail) { apply(state) }
                }
                if !isRunningTask { message = "Usage updated \(Date().formatted(date:.omitted,time:.shortened))." }
            } catch is CancellationError { }
            catch { self.error = "Usage refresh: \(error.localizedDescription)" }
        }
    }
    func cancel() {
        operation?.cancel()
        message = "Stopping owned task…"
    }
    func shutdown() {
        shuttingDown = true
        timer?.invalidate(); timer = nil
        operation?.cancel()
        refreshOperation?.cancel()
        networkMonitor.cancel()
        if let wakeObserver { NSWorkspace.shared.notificationCenter.removeObserver(wakeObserver); self.wakeObserver = nil }
        if let activeObserver { NotificationCenter.default.removeObserver(activeObserver); self.activeObserver = nil }
        awake.stop(); keepAwakeActive = false
    }
    func saveSettings() {
        let wanted = settings
        let actualLoginEnabled = LoginService.statusText == "Enabled"
        if wanted.launchAtLogin != actualLoginEnabled {
            do { try LoginService.update(wanted.launchAtLogin) }
            catch { self.error = "Launch at login could not be changed: \(error.localizedDescription)"; return }
        }
        loginStatus = LoginService.statusText
        perform("configure",payload:["settings":wanted.jsonObject])
    }
    func run(prompt: String, providers: [String], dataClass: String, files: [String]) {
        guard !hasUnsavedSettings else { error = "Save your settings before starting a task."; return }
        guard !prompt.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty, !providers.isEmpty else {
            error = "Enter a task and select at least one provider."; return
        }
        perform("run",payload:["prompt":prompt,"providers":providers,"dataClass":dataClass,"files":files],includeSecrets:true,task:true)
    }
    func saveSecret(_ name: String, value: String) {
        guard ["deepseek","nvidia","relay"].contains(name) else { error = "Unsupported credential."; return }
        do { try SecretStore.set(name,value:value); message = "Credential saved in this Mac's Keychain." }
        catch { self.error = error.localizedDescription }
    }
    func requestNotifications() {
        Task {
            do {
                _ = try await UNUserNotificationCenter.current().requestAuthorization(options:[.alert,.sound,.badge])
                await updateNotificationStatus()
                if notificationStatus == "Allowed" {
                    let content = UNMutableNotificationContent()
                    content.title = "TeamLoop notifications are ready"
                    content.body = "Usage warnings will appear here when fresh provider readings cross 50%, 75%, or 90% used."
                    try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier:"teamloop-setup-test",content:content,trigger:nil))
                }
            } catch { self.error = "Notification setup: \(error.localizedDescription)" }
        }
    }
    func exportDiagnostics() { perform("diagnostics") }
    func testEmail() { perform("test-email",includeSecrets:true) }
    func prepareGoogle() { perform("prepare-provider",payload:["provider":"gemini"]) }
    func signIn(provider: String, pathKey: String) {
        guard !shuttingDown, !isWorking else { return }
        isWorking = true; error = nil
        operation = Task {
            defer { isWorking = false; operation = nil; scheduleTimer() }
            do {
                var toolPath = settings.paths[pathKey] ?? ""
                if !FileManager.default.isExecutableFile(atPath:toolPath) {
                    let fresh = try JSONDecoder().decode(CoreSnapshot.self,from:try await bridge.request("snapshot"))
                    apply(fresh)
                    toolPath = fresh.settings.paths[pathKey] ?? ""
                }
                try Task.checkCancellation()
                try ProviderSetup.login(provider,path:toolPath)
                message = "Complete the official sign-in using the same account as your plan, then return here. TeamLoop will refresh the detected connection."
            } catch { self.error = error.localizedDescription }
        }
    }
    private func secrets(_ names: [String]) throws -> [String:String] {
        var result: [String:String] = [:]
        for name in names { if let value = try SecretStore.get(name) { result[name] = value } }
        return result
    }
    private func perform(_ action: String, payload: [String:Any] = [:], includeSecrets: Bool = false, task: Bool = false) {
        guard !shuttingDown, !isWorking else { return }
        isWorking = true; isRunningTask = task; error = nil
        message = task ? "TeamLoop is working. Results stay on this Mac." : "\(action.capitalized)…"
        updateAwake()
        operation = Task {
            defer {
                isWorking = false; isRunningTask = false; operation = nil
                updateAwake(); scheduleTimer()
            }
            do {
                var request = payload
                if includeSecrets { request["secrets"] = try secrets(SecretSelection.names(action:action,providers:payload["providers"] as? [String] ?? [],enabled:settings.enabledProviders)) }
                let data = try await bridge.request(action,payload:request,timeout:task ? 1800 : 180)
                try Task.checkCancellation()
                if action == "diagnostics" {
                    let object = try JSONDecoder().decode(JSONValue.self,from:data)
                    diagnosticText = object.pretty
                } else {
                    if let result = try? JSONDecoder().decode(CoreSnapshot.self,from:data) { apply(result,forceSettings:action == "configure") }
                    else {
                        let object = try JSONDecoder().decode(JSONValue.self,from:data)
                        if let failure = object.object["error"]?.string { throw NativeFailure.message(failure) }
                        apply(try JSONDecoder().decode(CoreSnapshot.self,from:try await bridge.request("snapshot")))
                    }
                    if action == "refresh" || action == "run" {
                        await publishPendingNotifications()
                        if savedSettings.emailEnabled {
                            let mailData = try await bridge.request("deliver",payload:["secrets":try secrets(["relay"])],timeout:90)
                            if let mail = try? JSONDecoder().decode(CoreSnapshot.self,from:mailData) { apply(mail) }
                        }
                    }
                }
                if action == "test-email" { message = "The relay accepted the test request. Confirm receipt at the paired address." }
                else if task {
                    switch snapshot?.runs.first?.object["status"]?.string {
                    case "completed": message = "Task completed. Review its results below."
                    case "completed-with-review-errors": message = "Primary answer saved; one or more reviews failed. See the provider errors below."
                    case "cancelled", "interrupted": message = "Task stopped. Review any retained partial results."
                    default: message = "Task failed. See its retained result and provider errors below."
                    }
                } else { message = "Updated \(Date().formatted(date:.omitted,time:.shortened))." }
                if action == "snapshot", !refreshedOnce {
                    refreshedOnce = true
                    // Deferred to the timer after this action releases the single-flight guard.
                    DispatchQueue.main.asyncAfter(deadline:.now()+0.5) { [weak self] in
                        guard let self, self.savedSettings.monitoringEnabled else { return }; self.refresh()
                    }
                }
            } catch is CancellationError { message = "Task stopped. Partial results were not promoted." }
            catch { self.error = error.localizedDescription; message = "Needs attention. Existing readings may be stale." }
        }
    }
    private func apply(_ newSnapshot: CoreSnapshot, forceSettings: Bool = false) {
        guard (newSnapshot.revision ?? 0) >= (snapshot?.revision ?? 0) else { return }
        let preserveEdits = hasUnsavedSettings && !forceSettings
        snapshot = newSnapshot
        if !preserveEdits { settings = newSnapshot.settings }
        loginStatus = LoginService.statusText
        updateAwake()
    }
    private func updateAwake() {
        awake.setEnabled(!shuttingDown && savedSettings.preventSleep && (savedSettings.monitoringEnabled || isRunningTask))
        keepAwakeActive = awake.isActive
    }
    private func scheduleTimer() {
        timer?.invalidate(); timer = nil
        guard !shuttingDown, savedSettings.monitoringEnabled else { return }
        timer = Timer.scheduledTimer(withTimeInterval:Double(max(60,savedSettings.pollSeconds)),repeats:true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.refresh() }
        }
    }
    private func updateNotificationStatus() async {
        let preferences = await UNUserNotificationCenter.current().notificationSettings()
        switch preferences.authorizationStatus {
        case .authorized, .provisional: notificationStatus = "Allowed"
        case .denied: notificationStatus = "Denied - enable in System Settings"
        case .notDetermined: notificationStatus = "Not yet requested"
        default: notificationStatus = "Unknown"
        }
    }
    private func publishPendingNotifications() async {
        await updateNotificationStatus()
        guard notificationStatus == "Allowed", let current = snapshot else { return }
        for event in current.events where event.localStatus == "pending" {
            guard !Task.isCancelled else { return }
            guard !notificationInFlight.contains(event.id) else { continue }
            // Never show a delayed quota warning as if it were a current reading.
            guard event.isEligible(in:current.meters) else { continue }
            notificationInFlight.insert(event.id)
            defer { notificationInFlight.remove(event.id) }
            do {
                if !delivered.contains(event.id) {
                    let content = UNMutableNotificationContent()
                    content.title = "\(event.provider.capitalized): \(Int(event.threshold))% used"
                    let reset = event.resetsAtMs.map { Date(timeIntervalSince1970:$0/1000).formatted(date:.abbreviated,time:.shortened) } ?? "not reported"
                    content.body = "\(event.label ?? event.windowId): \(Int(event.usedPercent))% used. Reset: \(reset)."
                    content.sound = .default
                    try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier:event.id,content:content,trigger:nil))
                    delivered.insert(event.id)
                    // The core owns long-term dedup; this small cache closes the OS-accept/ack crash gap.
                    if delivered.count > 2000 { delivered = [event.id] }
                    UserDefaults.standard.set(Array(delivered),forKey:"acceptedLocalEvents")
                }
                _ = try await bridge.request("acknowledge",payload:["eventId":event.id,"channel":"local"],timeout:30)
            } catch { self.error = "Local alert could not be acknowledged. Email delivery remains independent."; break }
        }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner,.sound])
    }
}
