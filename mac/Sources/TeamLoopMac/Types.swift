import Foundation

enum JSONValue: Codable, Equatable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null

    init(from decoder: Decoder) throws {
        let box = try decoder.singleValueContainer()
        if box.decodeNil() { self = .null }
        else if let v = try? box.decode(Bool.self) { self = .bool(v) }
        else if let v = try? box.decode(Double.self) { self = .number(v) }
        else if let v = try? box.decode(String.self) { self = .string(v) }
        else if let v = try? box.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try box.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var box = encoder.singleValueContainer()
        switch self {
        case .object(let v): try box.encode(v)
        case .array(let v): try box.encode(v)
        case .string(let v): try box.encode(v)
        case .number(let v): try box.encode(v)
        case .bool(let v): try box.encode(v)
        case .null: try box.encodeNil()
        }
    }
    var object: [String: JSONValue] { if case .object(let v) = self { return v }; return [:] }
    var array: [JSONValue] { if case .array(let v) = self { return v }; return [] }
    var string: String? { if case .string(let v) = self { return v }; return nil }
    var number: Double? { if case .number(let v) = self { return v }; return nil }
    var pretty: String {
        guard let data = try? JSONEncoder.pretty.encode(self) else { return "Unavailable" }
        return String(decoding: data, as: UTF8.self)
    }
}

extension JSONEncoder {
    static var pretty: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}

struct AppSettings: Codable, Equatable {
    var monitoringEnabled = true
    var preventSleep = true
    var launchAtLogin = false
    var pollSeconds = 300
    var emailEnabled = false
    var emailTo = ""
    var relayURL = ""
    var projectDir = ""
    var enabledProviders = ["codex", "claude", "gemini"]
    var paths: [String: String] = ["codex":"", "claude":"", "agy":"", "codexbar":""]
    var models: [String: String] = ["codex":"gpt-6.1-sol", "claude":"claude-sonnet-5-5", "gemini":"gemini-3.8-flash-high", "deepseek":"deepseek-flash", "nvidia":"nvidia/nemotron-3-ultra-550b-a55b"]
    var jsonObject: [String: Any] {
        guard let data = try? JSONEncoder().encode(self),
              let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return result
    }
}

struct QuotaMeter: Decodable, Identifiable {
    let provider: String
    let accountId: String
    let workspaceId: String?
    let poolId: String
    let scopeId: String?
    let windowId: String
    let usedPercent: Double?
    let observedAtMs: Double?
    let resetsAtMs: Double?
    let label: String?
    let source: String?
    let availability: String?
    var id: String { [provider,accountId,workspaceId ?? "",poolId,scopeId ?? "",windowId].map { "\($0.utf8.count):\($0)" }.joined() }
    func isFresh(now: Date = Date()) -> Bool {
        guard availability == "available", let observed = observedAtMs, observed <= now.timeIntervalSince1970 * 1000 + 30000,
              now.timeIntervalSince1970 * 1000 - observed <= 600000 else { return false }
        if let reset = resetsAtMs, reset <= now.timeIntervalSince1970 * 1000 { return false }
        return true
    }
}

struct ProviderHealth: Decodable, Identifiable {
    let provider: String
    let status: String
    let message: String?
    var id: String { provider }
}

struct QuotaAlert: Decodable, Identifiable {
    let id: String
    let provider: String
    let label: String?
    let windowId: String
    let threshold: Double
    let usedPercent: Double
    let observedAtMs: Double
    let resetsAtMs: Double?
    let scopeId: String?
    let accountId: String?
    let poolId: String?
    let workspaceId: String?
    let localStatus: String
    let emailStatus: String
    func isEligible(in meters: [QuotaMeter], now: Date = Date()) -> Bool {
        let nowMs = now.timeIntervalSince1970 * 1000
        guard nowMs - observedAtMs <= 600000, observedAtMs <= nowMs+30000,
              resetsAtMs.map({ $0 > nowMs }) ?? true else { return false }
        return meters.contains { meter in
            meter.provider == provider && meter.windowId == windowId && meter.scopeId == scopeId &&
            meter.accountId == accountId && meter.poolId == poolId && meter.workspaceId == workspaceId &&
            meter.resetsAtMs == resetsAtMs && meter.isFresh(now:now) && (meter.usedPercent ?? -1) >= threshold
        }
    }
}

struct CoreSnapshot: Decodable {
    let revision: Int?
    let settings: AppSettings
    let meters: [QuotaMeter]
    let health: [ProviderHealth]
    let events: [QuotaAlert]
    let runs: [JSONValue]
    let policy: JSONValue?
}

enum NativeFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let v) = self { return v }; return nil }
}

enum ShellText {
    /// One POSIX shell word, including empty strings and embedded apostrophes.
    static func quote(_ value: String) -> String { "'" + value.replacingOccurrences(of:"'", with:"'\\''") + "'" }
    /// A literal AppleScript string; never interpolate shell text as AppleScript code.
    static func appleScript(_ value: String) -> String {
        "\"" + value.replacingOccurrences(of:"\\",with:"\\\\").replacingOccurrences(of:"\"",with:"\\\"").replacingOccurrences(of:"\n",with:"\\n").replacingOccurrences(of:"\r",with:"\\r") + "\""
    }
}

enum SecretSelection {
    static func names(action: String, providers: [String], enabled: [String]) -> [String] {
        if action == "deliver" || action == "test-email" { return ["relay"] }
        let selected = action == "run" ? providers : action == "refresh" ? enabled : []
        return ["deepseek","nvidia"].filter { selected.contains($0) }
    }
}
