import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var model: AppModel?
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { model?.shutdown() }
}

@main
@MainActor
struct TeamLoopApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel()
    var body: some Scene {
        Window("TeamLoop",id:"main") {
            MainView(model:model)
                .frame(minWidth:860,minHeight:640)
                .onAppear { delegate.model = model; model.start() }
        }
        .defaultSize(width:1040,height:760)
        MenuBarExtra {
            MenuContent(model:model)
        } label: {
            Label(model.isRunningTask ? "TeamLoop working" : "TeamLoop",systemImage:model.keepAwakeActive ? "sparkles" : "circle.hexagongrid")
                .onAppear { delegate.model = model; model.start() }
        }
    }
}

@MainActor private struct MenuContent: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("Open TeamLoop") { openWindow(id:"main"); NSApp.activate(ignoringOtherApps:true); model.start() }
        Text(model.keepAwakeActive ? "Idle sleep prevention active" : "Normal sleep allowed")
        if let snapshot = model.snapshot {
            ForEach(snapshot.meters.prefix(8)) { meter in
                Text("\(meter.provider.capitalized) \(meter.label ?? meter.windowId): \(meter.isFresh() ? meter.usedPercent.map { "\(Int($0))% used" } ?? "Unknown" : "Stale / unavailable")")
            }
        }
        Divider()
        Button("Refresh usage") { model.refresh() }.disabled(model.isRefreshing)
        if model.isRunningTask { Button("Stop owned task") { model.cancel() } }
        Button("Quit TeamLoop") { model.shutdown(); NSApp.terminate(nil) }
    }
}

@MainActor private struct MainView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        VStack(alignment:.leading,spacing:14) {
            HStack {
                VStack(alignment:.leading,spacing:3) {
                    Text("TeamLoop").font(.largeTitle.weight(.semibold))
                    Text("Your assistants, connected on this Mac.").foregroundStyle(.secondary)
                }
                Spacer()
                Label(model.keepAwakeActive ? "Keeping Mac awake" : "Normal sleep",systemImage:"moon.zzz").foregroundStyle(.secondary)
                if model.isWorking || model.isRefreshing { ProgressView().controlSize(.small) }
            }
            TabView {
                SetupView(model:model).tabItem { Label("Setup",systemImage:"checklist") }
                TaskView(model:model).tabItem { Label("Tasks",systemImage:"text.bubble") }
                UsageView(model:model).tabItem { Label("Usage",systemImage:"gauge.with.dots.needle.50percent") }
                SettingsView(model:model).tabItem { Label("Settings",systemImage:"gearshape") }
            }
            Text(model.message).font(.callout).foregroundStyle(.secondary)
            if let error = model.error {
                HStack(alignment:.top) {
                    Image(systemName:"exclamationmark.triangle.fill").foregroundStyle(.orange)
                    Text(error).font(.callout).textSelection(.enabled)
                    Spacer(); Button("Dismiss") { model.error = nil }
                }
                .padding(10).background(.orange.opacity(0.08),in:RoundedRectangle(cornerRadius:8))
            }
        }
        .padding(22)
    }
}

@MainActor private struct SetupView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:18) {
                Text("Set up your team").font(.title2.weight(.semibold))
                Text("Follow each numbered guide. If both plans are new, ChatGPT Plus ($20/month) and Claude Pro ($20/month) total $40/month US before applicable tax. Your existing Google cost is unchanged by this guide. Prices were checked November 1, 2026; confirm the official checkout total before paying.")
                Text("All signup and payment happen on the providers' official websites. TeamLoop does not collect payment details, purchase plans, or create separate API accounts.").font(.callout).foregroundStyle(.secondary)
                ForEach(EnrollmentGuide.subscriptions) { guide in
                    SubscriptionSetupCard(model:model,guide:guide)
                }
                GoogleSetupCard(model:model)
                GroupBox("Usage helper") {
                    VStack(alignment:.leading,spacing:8) {
                        Text("Install CodexBar for the Claude usage connection. Download its Mac app, open the download, and move CodexBar to Applications. TeamLoop will detect its bundled helper; you do not need to install a separate command-line shortcut.")
                        HStack {
                            Button("Download CodexBar") { ProviderSetup.openInstall("codexbar") }
                            Text((model.settings.paths["codexbar"] ?? "").isEmpty ? "Helper not detected yet" : "Helper detected").font(.caption).foregroundStyle(.secondary)
                        }
                    }.frame(maxWidth:.infinity,alignment:.leading).padding(4)
                }
                DisclosureGroup("Advanced tool paths and troubleshooting") {
                    VStack(alignment:.leading,spacing:10) {
                        Text("Paths are detected automatically after installation. Use these fields only if a tool was installed in an unusual location.").font(.caption).foregroundStyle(.secondary)
                        ForEach([("codex","Codex CLI"),("claude","Claude Code"),("agy","Antigravity CLI"),("codexbar","CodexBar helper")],id:\.0) { key,title in
                            HStack {
                                TextField(title,text:Binding(get:{model.settings.paths[key] ?? ""},set:{model.settings.paths[key] = $0})).font(.system(.callout,design:.monospaced))
                                Button("Locate…") { locate(key) }
                            }
                        }
                        Button("Save advanced paths") { model.saveSettings() }.disabled(model.isWorking)
                        Text("If an install fails, read the error in Terminal and try its official instructions. If login used the wrong account, sign in again with the account that owns the plan. If a tool is installed but not detected, return to TeamLoop and refresh. An unavailable usage meter does not mean you need to buy a higher plan.").font(.callout).foregroundStyle(.secondary)
                    }.padding(.top,8)
                }
                HStack {
                    Button("Refresh connections and usage") { model.refresh() }.disabled(model.isRefreshing)
                    Spacer()
                    Button("Enable / test notifications") { model.requestNotifications() }
                }
                Text("Notifications: \(model.notificationStatus)").font(.callout).foregroundStyle(.secondary)
                Text("The saved checkboxes are your own progress notes. They do not verify a purchase, login identity, quota, or model entitlement. Tool and usage status below each guide comes from actual checks.").font(.caption).foregroundStyle(.secondary)
            }.padding(18)
        }
    }
    private func locate(_ key: String) {
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.canChooseFiles = true; panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url { model.settings.paths[key] = url.path }
    }
}

@MainActor private struct SubscriptionSetupCard: View {
    @ObservedObject var model: AppModel
    let guide: EnrollmentGuide
    @AppStorage private var alreadySubscribed: Bool
    @AppStorage private var accountAcknowledged: Bool
    @AppStorage private var planAcknowledged: Bool
    @AppStorage private var loginAcknowledged: Bool
    init(model: AppModel, guide: EnrollmentGuide) {
        _model = ObservedObject(wrappedValue:model); self.guide = guide
        _alreadySubscribed = AppStorage(wrappedValue:false,"setup.\(guide.provider).alreadySubscribed")
        _accountAcknowledged = AppStorage(wrappedValue:false,"setup.\(guide.provider).accountAcknowledged")
        _planAcknowledged = AppStorage(wrappedValue:false,"setup.\(guide.provider).planAcknowledged")
        _loginAcknowledged = AppStorage(wrappedValue:false,"setup.\(guide.provider).loginAcknowledged")
    }
    var body: some View {
        GroupBox("\(guide.title) \(guide.plan) · $\(guide.monthlyUSD)/month US") {
            VStack(alignment:.leading,spacing:14) {
                Text("Your saved checklist is a progress note, not proof of payment or access. Actual tool and usage checks appear in step 5.").font(.caption).foregroundStyle(.secondary)
                Toggle("I already have this plan",isOn:$alreadySubscribed).toggleStyle(.checkbox)
                GuidedSetupStep(number:1,title:alreadySubscribed ? "Open your existing \(guide.title) account" : "Create or sign in to your \(guide.title) account") {
                    Text("Use the email or Apple/Google sign-in you want to use on this Mac. Keep track of that exact account for the tool login below.")
                    Button("Open \(guide.title)") { ProviderSetup.openSignup(guide.provider) }
                    Toggle("I created or signed in to my account",isOn:$accountAcknowledged).toggleStyle(.checkbox)
                }
                GuidedSetupStep(number:2,title:alreadySubscribed ? "Confirm your existing \(guide.plan) plan" : "Choose \(guide.plan) monthly at $20/month US") {
                    if alreadySubscribed {
                        Text("Check your current account's subscription. You do not need to buy this plan again.")
                    } else {
                        Text("On the official website, choose \(guide.plan), then Monthly. Check the $20/month US base price and any applicable tax before you approve payment. Do not select annual billing, a higher tier, or API credits. A discounted monthly equivalent billed annually is not the monthly option.")
                    }
                    Button("Check current plan and pricing") { ProviderSetup.openPricing(guide.provider) }
                    Toggle(alreadySubscribed ? "I confirm I already have \(guide.title) \(guide.plan)" : "I chose \(guide.title) \(guide.plan) monthly and completed checkout",isOn:$planAcknowledged).toggleStyle(.checkbox)
                }
                GuidedSetupStep(number:3,title:"Return here and install \(guide.tool)") {
                    Text("Click Install and allow the official installer to finish in Terminal. Return to TeamLoop afterward; the tool should be detected automatically.")
                    HStack {
                        Button("Install \(guide.tool)") { install() }.disabled(model.isWorking)
                        Button("Official installation help") { ProviderSetup.openInstall(guide.provider) }
                    }
                }
                GuidedSetupStep(number:4,title:"Sign the tool into the same account") {
                    Text("Choose your \(guide.title) subscription account in the official sign-in window. Do not create a separate Codex, Claude Console, or API account. Complete any verification, then return here.")
                    Button("Sign in to \(guide.tool)") { model.signIn(provider:guide.provider,pathKey:guide.pathKey) }.disabled(model.isWorking || model.isRefreshing)
                    Toggle("I completed the official tool sign-in",isOn:$loginAcknowledged).toggleStyle(.checkbox)
                }
                GuidedSetupStep(number:5,title:"Refresh and check the connection") {
                    Button("Refresh \(guide.title) status") { model.refresh() }.disabled(model.isRefreshing)
                    ObservedSetupStatus(model:model,provider:guide.provider,pathKey:guide.pathKey)
                    Text("Model access is separate from the checklist. Run a small task after setup to check the selected model.").font(.caption).foregroundStyle(.secondary)
                }
            }.frame(maxWidth:.infinity,alignment:.leading).padding(8)
        }
    }
    private func install() { do { try ProviderSetup.install(guide.provider) } catch { model.error = error.localizedDescription } }
}

@MainActor private struct GoogleSetupCard: View {
    @ObservedObject var model: AppModel
    @AppStorage("setup.google.accountAcknowledged") private var accountAcknowledged = false
    @AppStorage("setup.google.loginAcknowledged") private var loginAcknowledged = false
    @AppStorage("setup.google.desktopAcknowledged") private var desktopAcknowledged = false
    var body: some View {
        GroupBox("Google Antigravity · reuse your existing Gemini account") {
            VStack(alignment:.leading,spacing:14) {
                GuidedSetupStep(number:1,title:"Use your existing Google account") {
                    Text("Use the same Google account you already use for Gemini, whether it is free or paid. This guide does not require a new Google purchase. Available Antigravity models and limits depend on that account.")
                    Toggle("I know which Google account I use for Gemini",isOn:$accountAcknowledged).toggleStyle(.checkbox)
                }
                GuidedSetupStep(number:2,title:"Install the required Antigravity CLI") {
                    Text("TeamLoop needs Google's command-line tool, named agy. The button runs Google's official Mac installer in Terminal. Let it finish, then return here; TeamLoop checks the normal installation location automatically.")
                    HStack {
                        Button("Install Antigravity CLI") { do { try ProviderSetup.install("gemini") } catch { model.error = error.localizedDescription } }.disabled(model.isWorking)
                        Button("Official getting-started guide") { ProviderSetup.openInstall("gemini") }
                    }
                }
                GuidedSetupStep(number:3,title:"Sign in with the same Google account") {
                    Text("Open the official CLI sign-in, choose Personal Google and your existing Gemini email, and finish Google's prompts. If asked about colors or rendering, choose the displayed default. If asked to trust a folder, trust only the TeamLoop setup folder opened for you. Return here afterward. Installing the desktop app alone does not finish this CLI login.")
                    Button("Sign in to Antigravity CLI") { model.signIn(provider:"gemini",pathKey:"agy") }.disabled(model.isWorking || model.isRefreshing)
                    Toggle("I completed CLI sign-in with my existing Google account",isOn:$loginAcknowledged).toggleStyle(.checkbox)
                }
                GuidedSetupStep(number:4,title:"Refresh usage and prepare the optional reviewer") {
                    HStack {
                        Button("Refresh Google status") { model.refresh() }.disabled(model.isRefreshing)
                        Button("Prepare Google reviewer") { model.prepareGoogle() }.disabled(model.isWorking)
                    }
                    ObservedSetupStatus(model:model,provider:"gemini",pathKey:"agy")
                    Text("Prepare backs up existing CLI settings and applies restricted review settings. Google reviewing remains a Public/Synthetic pilot; unavailable quota identity or models stay unverified.").font(.caption).foregroundStyle(.secondary)
                }
                DisclosureGroup("Optional: install the Antigravity desktop app too") {
                    VStack(alignment:.leading,spacing:8) {
                        Text("1. Open Google's download page and choose the Mac Apple Silicon desktop app.\n2. Open the downloaded DMG and drag Antigravity to Applications.\n3. Open Antigravity from Applications and sign in with the same existing Google account.\n4. Return to TeamLoop. The required CLI installation and login above are separate.")
                        Button("Open official Mac desktop download") { ProviderSetup.openGoogleDesktop() }
                        Toggle("I installed the optional desktop app",isOn:$desktopAcknowledged).toggleStyle(.checkbox)
                    }.padding(.top,8)
                }
            }.frame(maxWidth:.infinity,alignment:.leading).padding(8)
        }
    }
}

@MainActor private struct GuidedSetupStep<Content: View>: View {
    let number: Int
    let title: String
    let content: Content
    init(number: Int, title: String, @ViewBuilder content: () -> Content) {
        self.number = number; self.title = title; self.content = content()
    }
    var body: some View {
        VStack(alignment:.leading,spacing:7) {
            Text("\(number). \(title)").font(.headline)
            content.font(.callout)
        }.frame(maxWidth:.infinity,alignment:.leading)
    }
}

@MainActor private struct ObservedSetupStatus: View {
    @ObservedObject var model: AppModel
    let provider: String
    let pathKey: String
    private var health: ProviderHealth? { model.snapshot?.health.first { $0.provider == provider } }
    private var accounts: [String] { Array(Set((model.snapshot?.meters ?? []).filter { $0.provider == provider && $0.isFresh() }.map(\.accountId))).sorted() }
    var body: some View {
        VStack(alignment:.leading,spacing:4) {
            Text(FileManager.default.isExecutableFile(atPath:model.settings.paths[pathKey] ?? "") ? "Detected tool: executable found" : "Detected tool: not found yet")
            Text("Observed usage status: \(health?.status ?? "not checked")")
            if let message = health?.message, !message.isEmpty { Text(message) }
            Text(accounts.isEmpty ? "Account identity: not yet reported" : "Observed account: \(accounts.joined(separator:", "))").textSelection(.enabled)
        }.font(.caption).foregroundStyle(.secondary)
    }
}

@MainActor private struct TaskView: View {
    @ObservedObject var model: AppModel
    @State private var prompt = ""
    @State private var primary = "codex"
    @State private var reviewers = Set(["claude"])
    @State private var dataClass = "private"
    @State private var files: [String] = []
    var body: some View {
        VStack(alignment:.leading,spacing:12) {
            Text("Ask the team").font(.title2.weight(.semibold))
            Text("Text-only advisory work. Selected files are the only file evidence supplied. Review results before applying changes.").font(.callout).foregroundStyle(.secondary)
            TextEditor(text:$prompt).font(.body).frame(minHeight:110,maxHeight:170).border(.quaternary)
            HStack {
                Picker("Primary",selection:$primary) { ForEach(["codex","claude","gemini","deepseek","nvidia"],id:\.self) { Text($0.capitalized).tag($0) } }.frame(width:210)
                Text("Reviewers (up to 2):").font(.caption)
                ForEach(["codex","claude","gemini","deepseek","nvidia"].filter { $0 != primary },id:\.self) { provider in
                    Toggle(provider.capitalized,isOn:Binding(get:{reviewers.contains(provider)},set:{ value in if value { reviewers.insert(provider) } else { reviewers.remove(provider) } })).toggleStyle(.checkbox)
                }
            }
            HStack {
                Picker("Data",selection:$dataClass) { Text("Private").tag("private");Text("Public").tag("public");Text("Synthetic").tag("synthetic") }.frame(width:220)
                Button("Add files…") { addFiles() }
                if !files.isEmpty { Text("\(files.count) selected").font(.caption);Button("Clear") { files = [] } }
                Spacer()
                if model.isRunningTask { Button("Stop") { model.cancel() } }
                Button("Run team") { model.run(prompt:prompt,providers:[primary] + ["codex","claude","gemini","deepseek","nvidia"].filter { $0 != primary && reviewers.contains($0) },dataClass:dataClass,files:files) }.buttonStyle(.borderedProminent).disabled(model.isWorking || model.hasUnsavedSettings || reviewers.subtracting([primary]).count > 2)
            }
            Text("DeepSeek and NVIDIA require Public or Synthetic data and their own API keys. No automatic provider or paid-API fallback.").font(.caption).foregroundStyle(.secondary)
            Text("Google reviewer is a Public/Synthetic pilot. Use Prepare Google reviewer in Setup before selecting it.").font(.caption).foregroundStyle(.secondary)
            Divider()
            ScrollView {
                VStack(alignment:.leading,spacing:12) {
                    if let runs = model.snapshot?.runs, !runs.isEmpty {
                        ForEach(Array(runs.enumerated()),id:\.offset) { _,run in
                            TaskResultView(run:run)
                        }
                    } else { Text("Completed task results appear here.").foregroundStyle(.secondary) }
                }.frame(maxWidth:.infinity,alignment:.leading)
            }
        }.padding(18)
    }
    private func addFiles() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = true
        if panel.runModal() == .OK { files = Array(Set(files + panel.urls.map(\.path))).sorted() }
    }
}

@MainActor private struct TaskResultView: View {
    let run: JSONValue
    private var answer: String { run.object["text"]?.string ?? "" }
    private var status: String { (run.object["status"]?.string ?? "unknown").replacingOccurrences(of:"-",with:" ").capitalized }
    private var errors: [JSONValue] { run.object["errors"]?.array ?? [] }
    private var results: [JSONValue] { run.object["results"]?.array ?? [] }
    private var artifact: String? { run.object["artifact"]?.string }
    var body: some View {
        VStack(alignment:.leading,spacing:10) {
            HStack {
                Text(status).font(.headline)
                Spacer()
                Button("Copy answer") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(answer,forType:.string)
                }.disabled(answer.isEmpty)
                if artifact != nil { Button("Reveal saved full result") { revealArtifact() } }
            }
            if let started = run.object["startedAtMs"]?.number {
                Text(Date(timeIntervalSince1970:started/1000).formatted(date:.abbreviated,time:.shortened)).font(.caption).foregroundStyle(.secondary)
            }
            if !answer.isEmpty {
                Text(answer).font(.body).textSelection(.enabled).frame(maxWidth:.infinity,alignment:.leading)
                if answer.count >= 16000 { Text("This history entry may be shortened. Reveal the saved full result for the complete answer.").font(.caption).foregroundStyle(.secondary) }
            } else { Text("No final answer was produced. Check the status and any provider errors.").foregroundStyle(.secondary) }
            if let failure = run.object["error"]?.string {
                Label(failure,systemImage:"exclamationmark.triangle").foregroundStyle(.orange).textSelection(.enabled)
            }
            ForEach(Array(errors.enumerated()),id:\.offset) { _,failure in
                Text("\(failure.object["provider"]?.string?.capitalized ?? "Provider"): \(failure.object["message"]?.string ?? "Failed")").font(.callout).foregroundStyle(.orange).textSelection(.enabled)
            }
            if !results.isEmpty {
                DisclosureGroup("Draft and independent reviews") {
                    VStack(alignment:.leading,spacing:12) {
                        ForEach(Array(results.enumerated()),id:\.offset) { index,result in
                            VStack(alignment:.leading,spacing:5) {
                                Text("\(index == 0 ? "Draft" : "Review") · \(result.object["provider"]?.string?.capitalized ?? "Provider")").font(.headline)
                                Text(result.object["text"]?.string ?? "No text retained").textSelection(.enabled)
                            }
                        }
                    }.frame(maxWidth:.infinity,alignment:.leading).padding(.top,6)
                }
            }
            DisclosureGroup("Technical details") {
                Text(run.pretty).font(.system(.caption,design:.monospaced)).textSelection(.enabled).frame(maxWidth:.infinity,alignment:.leading)
            }
        }.frame(maxWidth:.infinity,alignment:.leading).padding(14).background(.quaternary.opacity(0.35),in:RoundedRectangle(cornerRadius:8))
    }
    private func revealArtifact() {
        guard let artifact, NSString(string:artifact).isAbsolutePath else { return }
        let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/TeamLoop/runs",isDirectory:true).resolvingSymlinksInPath().standardizedFileURL
        let url = URL(fileURLWithPath:artifact).resolvingSymlinksInPath().standardizedFileURL
        guard url.path.hasPrefix(root.path + "/"), FileManager.default.fileExists(atPath:url.path) else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }
}

@MainActor private struct UsageView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:14) {
                HStack { Text("Usage and limits").font(.title2.weight(.semibold));Spacer();Button("Refresh") { model.refresh() }.disabled(model.isRefreshing) }
                Text("Warnings at 50%, 75% and 90% used for each reported subscription window. Missing data stays unknown. DeepSeek balance and NVIDIA request status do not provide five-hour or weekly subscription percentages; custom API budgets are not implemented in this version.").font(.callout).foregroundStyle(.secondary)
                if let snapshot = model.snapshot {
                    ForEach(snapshot.health) { health in
                        HStack { Text(health.provider.capitalized).font(.headline);Text(health.status).foregroundStyle(.secondary);Spacer();Text(health.message ?? "").font(.caption).foregroundStyle(.secondary) }
                    }
                    ForEach(snapshot.meters) { meter in
                        GroupBox {
                            VStack(alignment:.leading,spacing:7) {
                                HStack { Text("\(meter.provider.capitalized) · \(meter.label ?? meter.windowId)").font(.headline);Spacer();Text(meter.isFresh() ? "Current" : "Stale / unavailable").foregroundStyle(meter.isFresh() ? Color.secondary : Color.orange) }
                                if let percent = meter.usedPercent {
                                    ProgressView(value:min(100,max(0,percent)),total:100)
                                    Text("\(percent,specifier:"%.1f")% used · \(max(0,100-percent),specifier:"%.1f")% remaining")
                                } else { Text("Percentage not reported") }
                                HStack {
                                    Text("Reset: \(time(meter.resetsAtMs))")
                                    Spacer()
                                    Text("Observed: \(time(meter.observedAtMs))")
                                }.font(.caption).foregroundStyle(.secondary)
                                Text("Source: \(meter.source ?? "not reported") · pool \(meter.poolId)").font(.caption).foregroundStyle(.secondary)
                            }.padding(4)
                        }
                    }
                    if snapshot.meters.isEmpty { Text("No verified meters yet. Finish setup or repair the indicated connection.").padding(.vertical).foregroundStyle(.secondary) }
                    ForEach(snapshot.events.suffix(20)) { event in
                        Text("\(event.provider.capitalized) \(Int(event.threshold))% · local: \(event.localStatus) · email: \(event.emailStatus)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }.padding(18)
        }
    }
    private func time(_ milliseconds: Double?) -> String { milliseconds.map { Date(timeIntervalSince1970:$0/1000).formatted(date:.abbreviated,time:.shortened) } ?? "Not reported" }
}

@MainActor private struct SettingsView: View {
    @ObservedObject var model: AppModel
    @State private var deepseek = ""
    @State private var nvidia = ""
    @State private var relay = ""
    var body: some View {
        Form {
            Section("Monitoring") {
                Toggle("Monitor usage",isOn:$model.settings.monitoringEnabled)
                Toggle("Prevent idle sleep while monitoring or running tasks",isOn:$model.settings.preventSleep)
                Text("The display can turn off. Deliberate sleep, logout, shutdown or loss of power still interrupt monitoring.").font(.caption).foregroundStyle(.secondary)
                Toggle("Open TeamLoop at login",isOn:$model.settings.launchAtLogin)
                HStack { Text("macOS login status: \(model.loginStatus)");Button("Manage login items") { LoginService.openSettings() } }
                Stepper("Refresh every \(model.settings.pollSeconds) seconds",value:$model.settings.pollSeconds,in:60...3600,step:60)
                HStack { TextField("Project folder",text:$model.settings.projectDir);Button("Choose…") { chooseProject() } }
                HStack {
                    Text("Monitor:")
                    ForEach(["codex","claude","gemini","deepseek","nvidia"],id:\.self) { provider in
                        Toggle(provider.capitalized,isOn:Binding(get:{model.settings.enabledProviders.contains(provider)},set:{ enabled in
                            if enabled { if !model.settings.enabledProviders.contains(provider) { model.settings.enabledProviders.append(provider) } }
                            else { model.settings.enabledProviders.removeAll { $0 == provider } }
                        })).toggleStyle(.checkbox)
                    }
                }
            }
            Section("Email usage warnings") {
                Toggle("Email usage warnings",isOn:$model.settings.emailEnabled)
                TextField("Paired recipient email",text:$model.settings.emailTo)
                TextField("HTTPS alert-relay URL",text:$model.settings.relayURL)
                HStack { SecureField("Device relay token",text:$relay);Button("Save relay token") { model.saveSecret("relay",value:relay);relay = "" } }
                Text("Use a deployed, destination-restricted relay and a verified recipient. No email is sent until enabled and configured; only usage metadata is eligible.").font(.caption).foregroundStyle(.secondary)
                Button("Send a test email") { model.testEmail() }.disabled(model.isWorking || !model.settings.emailEnabled || model.hasUnsavedSettings)
                if model.hasUnsavedSettings { Text("Save settings before testing email or starting work.").font(.caption).foregroundStyle(.secondary) }
            }
            Section("Optional API credentials") {
                HStack { SecureField("DeepSeek API key",text:$deepseek);Button("Save DeepSeek key") { model.saveSecret("deepseek",value:deepseek);deepseek = "" };Button("Create key") { ProviderSetup.openInstall("deepseek") } }
                HStack { SecureField("NVIDIA API key",text:$nvidia);Button("Save NVIDIA key") { model.saveSecret("nvidia",value:nvidia);nvidia = "" };Button("Create key") { ProviderSetup.openInstall("nvidia") } }
                Text("Values are stored in this Mac's Keychain. Saving an empty field removes that app-owned key. Subscription login remains managed by the official provider tools.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Explicit models") {
                ForEach(["codex","claude","gemini","deepseek","nvidia"],id:\.self) { provider in
                    TextField(provider.capitalized,text:Binding(get:{model.settings.models[provider] ?? ""},set:{model.settings.models[provider] = $0})).font(.system(.callout,design:.monospaced))
                }
                Text("Aliases are configured defaults, not verified entitlements. Failed models are not silently replaced.").font(.caption).foregroundStyle(.secondary)
            }
            HStack { Button("Save settings") { model.saveSettings() }.buttonStyle(.borderedProminent).disabled(model.isWorking);Button("Safe diagnostics") { model.exportDiagnostics() }.disabled(model.isWorking) }
            if !model.diagnosticText.isEmpty { Text(model.diagnosticText).font(.system(.caption,design:.monospaced)).textSelection(.enabled) }
        }.formStyle(.grouped).disabled(model.isWorking || model.isRefreshing)
    }
    private func chooseProject() {
        let panel = NSOpenPanel();panel.canChooseDirectories = true;panel.canChooseFiles = false
        if panel.runModal() == .OK,let url = panel.url { model.settings.projectDir = url.path }
    }
}
