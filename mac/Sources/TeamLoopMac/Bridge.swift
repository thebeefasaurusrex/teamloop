import Foundation
import Darwin

/// Owns one process and permits cancellation before or after launch.
final class ProcessOwner: @unchecked Sendable {
    private let lock = NSLock()
    private var child: Process?
    private var cancelled = false
    func start(_ process: Process) throws {
        lock.lock(); defer { lock.unlock() }
        guard !cancelled else { throw CancellationError() }
        try process.run()
        child = process
    }
    func stop() {
        lock.lock(); cancelled = true; let process = child; lock.unlock()
        if let process, process.isRunning {
            process.terminate()
            DispatchQueue.global(qos:.utility).asyncAfter(deadline:.now()+3) {
                if process.isRunning { Darwin.kill(process.processIdentifier,SIGKILL) }
            }
        }
    }
}

final class BoundedCapture: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var stdout = Data()
    private(set) var stderr = Data()
    private(set) var overflow = false
    private let limit: Int
    init(limit: Int) { self.limit = limit }
    func append(_ data: Data, isError: Bool) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard stdout.count + stderr.count + data.count <= limit else { overflow = true; return false }
        if isError { stderr.append(data) } else { stdout.append(data) }
        return true
    }
}

struct CoreBridge: Sendable {
    let resourceURL: URL
    let stateURL: URL
    init(resourceURL: URL = Bundle.main.resourceURL ?? URL(fileURLWithPath:"/"), stateURL: URL? = nil) {
        self.resourceURL = resourceURL
        self.stateURL = stateURL ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/TeamLoop",isDirectory:true)
    }
    func request(_ action: String, payload: [String: Any] = [:], timeout: TimeInterval = 180) async throws -> Data {
        let allowed = ["snapshot","configure","refresh","run","acknowledge","deliver","diagnostics","test-email","prepare-provider"]
        guard allowed.contains(action) else { throw NativeFailure.message("Unsupported core action.") }
        var input = try JSONSerialization.data(withJSONObject:payload)
        guard input.count <= 3 * 1024 * 1024 else { throw NativeFailure.message("Request exceeds the local message limit.") }
        input.append(10)
        let owner = ProcessOwner()
        return try await withTaskCancellationHandler(operation: {
            try await Task.detached(priority:.userInitiated) {
                try FileManager.default.createDirectory(at:self.stateURL,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
                let node = self.resourceURL.appendingPathComponent("runtime/node")
                let cli = self.resourceURL.appendingPathComponent("core/cli.mjs")
                guard FileManager.default.isExecutableFile(atPath:node.path), FileManager.default.fileExists(atPath:cli.path) else {
                    throw NativeFailure.message("The bundled runtime is missing. Use the complete built TeamLoop.app, not the source executable.")
                }
                let process = Process()
                process.executableURL = node
                process.arguments = ["--jitless",cli.path,action]
                // No inherited provider keys, shell startup hooks, NODE_OPTIONS or alternate auth.
                let inherited = ProcessInfo.processInfo.environment
                var env = ["HOME":FileManager.default.homeDirectoryForCurrentUser.path,
                           "PATH":"/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin",
                           "TEAMLOOP_STATE_DIR":self.stateURL.path,
                           "LANG":inherited["LANG"] ?? "en_US.UTF-8",
                           "TMPDIR":NSTemporaryDirectory()]
                if let cert = inherited["SSL_CERT_FILE"], !cert.isEmpty { env["SSL_CERT_FILE"] = cert }
                process.environment = env
                process.currentDirectoryURL = self.stateURL
                let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
                process.standardInput = stdin; process.standardOutput = stdout; process.standardError = stderr
                let capture = BoundedCapture(limit:8 * 1024 * 1024)
                let group = DispatchGroup()
                try owner.start(process)
                for (pipe,isError) in [(stdout,false),(stderr,true)] {
                    group.enter()
                    DispatchQueue.global(qos:.utility).async {
                        defer { group.leave(); try? pipe.fileHandleForReading.close() }
                        do {
                            while let chunk = try pipe.fileHandleForReading.read(upToCount:65536), !chunk.isEmpty {
                                if !capture.append(chunk,isError:isError) { owner.stop(); break }
                            }
                        } catch { owner.stop() }
                    }
                }
                let timer = DispatchSource.makeTimerSource(queue:DispatchQueue.global(qos:.utility))
                timer.schedule(deadline:.now()+timeout)
                timer.setEventHandler { owner.stop() }
                timer.resume()
                defer { timer.cancel() }
                do { try stdin.fileHandleForWriting.write(contentsOf:input) } catch { owner.stop() }
                try? stdin.fileHandleForWriting.close()
                process.waitUntilExit()
                // Core owns provider process groups; a terminated core must close all descendant pipes.
                guard group.wait(timeout:.now()+10) == .success else { owner.stop(); throw NativeFailure.message("The core did not close its output streams after stopping.") }
                if capture.overflow { throw NativeFailure.message("Core response exceeded the message limit.") }
                guard !Task.isCancelled else { throw CancellationError() }
                guard process.terminationStatus == 0 else {
                    // Never expose arbitrary stderr (it may contain provider material).
                    if let object = try? JSONSerialization.jsonObject(with:capture.stdout) as? [String:Any],
                       let error = object["error"] as? String {
                        throw NativeFailure.message(String(error.prefix(1000)))
                    }
                    throw NativeFailure.message("Core operation stopped or failed. Refresh status or export safe diagnostics.")
                }
                guard !capture.stdout.isEmpty else { throw NativeFailure.message("The core returned no response.") }
                _ = try JSONSerialization.jsonObject(with:capture.stdout)
                return capture.stdout
            }.value
        }, onCancel: { owner.stop() })
    }
}
