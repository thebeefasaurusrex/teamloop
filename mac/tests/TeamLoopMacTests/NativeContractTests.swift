import XCTest
@testable import TeamLoopMac

final class NativeContractTests: XCTestCase {
    func testShellWordsAreQuoted() {
        XCTAssertEqual(ShellText.quote(""),"''")
        XCTAssertEqual(ShellText.quote("a b"),"'a b'")
        XCTAssertEqual(ShellText.quote("a'b"),"'a'\\''b'")
        XCTAssertEqual(ShellText.quote("$(whoami);x"),"'$(whoami);x'")
    }
    func testAppleScriptStringEscapesCodeBoundaries() {
        XCTAssertEqual(ShellText.appleScript("a\"b\\c\nd"),"\"a\\\"b\\\\c\\nd\"")
    }
    func testDefaultSettingsHaveNativeProductPolicy() {
        let s = AppSettings()
        XCTAssertTrue(s.monitoringEnabled)
        XCTAssertTrue(s.preventSleep)
        XCTAssertFalse(s.emailEnabled)
        XCTAssertEqual(s.pollSeconds,300)
        XCTAssertNil(s.jsonObject["billingCheckedAt"])
        XCTAssertNil(s.jsonObject["claudeAttestation"])
    }
    func testSettingsRoundTrip() throws {
        let original = AppSettings()
        XCTAssertEqual(try JSONDecoder().decode(AppSettings.self,from:JSONEncoder().encode(original)),original)
    }
    func testSignupGuidesSelectMonthlyTwentyDollarPlansAndOfficialSites() throws {
        XCTAssertEqual(EnrollmentGuide.subscriptions.count,2)
        XCTAssertEqual(EnrollmentGuide.subscription("codex")?.plan,"Plus")
        XCTAssertEqual(EnrollmentGuide.subscription("claude")?.plan,"Pro")
        for guide in EnrollmentGuide.subscriptions {
            XCTAssertEqual(guide.monthlyUSD,20)
            let signup = try XCTUnwrap(URL(string:guide.signupURL))
            XCTAssertEqual(signup.scheme,"https")
            XCTAssertTrue(["chatgpt.com","claude.ai"].contains(signup.host ?? ""))
            XCTAssertEqual(signup.path,"/")
            XCTAssertNotNil(URL(string:guide.pricingURL))
        }
        XCTAssertEqual(EnrollmentGuide.googleDesktopURL,"https://antigravity.google/download")
    }
    func testAllOfficialInstallersRestrictRedirectsToHTTPS() throws {
        for provider in ["codex","claude","gemini"] {
            let command = try XCTUnwrap(ProviderSetup.installerCommand(provider))
            XCTAssertTrue(command.contains("--proto '=https'"))
            XCTAssertTrue(command.contains("--proto-redir '=https'"))
        }
        XCTAssertTrue(try XCTUnwrap(ProviderSetup.installerCommand("gemini")).contains("https://antigravity.google/cli/install.sh"))
        XCTAssertNil(ProviderSetup.installerCommand("unknown-provider"))
    }
    func testJSONValueKeepsBooleansDistinctFromNumbers() throws {
        let value = try JSONDecoder().decode(JSONValue.self,from:Data("{\"enabled\":true,\"percent\":75,\"unknown\":null}".utf8))
        XCTAssertEqual(value.object["enabled"],.bool(true))
        XCTAssertEqual(value.object["percent"],.number(75))
        XCTAssertEqual(value.object["unknown"],.null)
    }
    func testCurrentExpiredMissingAndFutureMeters() throws {
        let now = Date(timeIntervalSince1970:1800000000)
        func meter(_ observed: Double, reset: String = "1800003600000", availability: String = "available") throws -> QuotaMeter {
            let json = "{\"provider\":\"test\",\"accountId\":\"a\",\"poolId\":\"p\",\"windowId\":\"weekly\",\"observedAtMs\":\(observed),\"resetsAtMs\":\(reset),\"usedPercent\":75,\"availability\":\"\(availability)\"}"
            return try JSONDecoder().decode(QuotaMeter.self,from:Data(json.utf8))
        }
        XCTAssertTrue(try meter(1800000000000).isFresh(now:now))
        XCTAssertFalse(try meter(1799999399999).isFresh(now:now))
        XCTAssertFalse(try meter(1800000030001).isFresh(now:now))
        XCTAssertFalse(try meter(1800000000000,reset:"1799999999999").isFresh(now:now))
        XCTAssertFalse(try meter(1800000000000,availability:"stale").isFresh(now:now))
    }
    func testOutputBoundIncludesBothStreams() {
        let capture = BoundedCapture(limit:10)
        XCTAssertTrue(capture.append(Data(repeating:65,count:6),isError:false))
        XCTAssertTrue(capture.append(Data(repeating:66,count:4),isError:true))
        XCTAssertFalse(capture.append(Data([67]),isError:false))
        XCTAssertTrue(capture.overflow)
        XCTAssertEqual(capture.stdout.count,6)
        XCTAssertEqual(capture.stderr.count,4)
    }
    func testOnlyRelevantSecretsAreRequested() {
        XCTAssertEqual(SecretSelection.names(action:"refresh",providers:[],enabled:["codex","claude"]),[])
        XCTAssertEqual(SecretSelection.names(action:"run",providers:["codex","nvidia"],enabled:["deepseek"]),["nvidia"])
        XCTAssertEqual(SecretSelection.names(action:"test-email",providers:[],enabled:["deepseek"]),["relay"])
        XCTAssertEqual(SecretSelection.names(action:"snapshot",providers:[],enabled:["deepseek"]),[])
    }
    func testPendingAlertRequiresExactFreshCurrentMeter() throws {
        let now = Date(timeIntervalSince1970:1800000000)
        let alertData = Data("{\"id\":\"event\",\"provider\":\"test\",\"accountId\":\"a\",\"poolId\":\"p\",\"workspaceId\":\"w\",\"windowId\":\"weekly\",\"threshold\":75,\"usedPercent\":76,\"observedAtMs\":1800000000000,\"resetsAtMs\":1800003600000,\"localStatus\":\"pending\",\"emailStatus\":\"pending\"}".utf8)
        let alert = try JSONDecoder().decode(QuotaAlert.self,from:alertData)
        func meter(account: String = "a", workspace: String = "w", reset: Double = 1800003600000, percent: Double = 76) throws -> QuotaMeter {
            let object: [String:Any] = ["provider":"test","accountId":account,"poolId":"p","workspaceId":workspace,"windowId":"weekly","usedPercent":percent,"observedAtMs":1800000000000,"resetsAtMs":reset,"availability":"available"]
            return try JSONDecoder().decode(QuotaMeter.self,from:JSONSerialization.data(withJSONObject:object))
        }
        XCTAssertTrue(try alert.isEligible(in:[meter()],now:now))
        XCTAssertFalse(try alert.isEligible(in:[meter(account:"b")],now:now))
        XCTAssertFalse(try alert.isEligible(in:[meter(workspace:"other")],now:now))
        XCTAssertFalse(try alert.isEligible(in:[meter(reset:1800007200000)],now:now))
        XCTAssertFalse(try alert.isEligible(in:[meter(percent:20)],now:now))
        XCTAssertFalse(try alert.isEligible(in:[meter()],now:now.addingTimeInterval(601)))
    }
    func testAwakeControllerIdempotence() async {
        await MainActor.run {
            let controller = AwakeController()
            XCTAssertFalse(controller.isActive)
            controller.setEnabled(true)
            XCTAssertTrue(controller.isActive)
            controller.setEnabled(true)
            controller.stop()
            XCTAssertFalse(controller.isActive)
        }
    }
}
