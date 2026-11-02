import Foundation

/// Instructions and user acknowledgements, never a receipt or entitlement assertion.
struct EnrollmentGuide: Identifiable {
    let provider: String
    let title: String
    let plan: String
    let tool: String
    let pathKey: String
    let signupURL: String
    let pricingURL: String
    let monthlyUSD: Int
    var id: String { provider }

    static let subscriptions: [EnrollmentGuide] = [
        EnrollmentGuide(provider:"codex",title:"ChatGPT",plan:"Plus",tool:"Codex CLI",pathKey:"codex",signupURL:"https://chatgpt.com/",pricingURL:"https://learn.chatgpt.com/docs/pricing",monthlyUSD:20),
        EnrollmentGuide(provider:"claude",title:"Claude",plan:"Pro",tool:"Claude Code",pathKey:"claude",signupURL:"https://claude.ai/",pricingURL:"https://support.claude.com/en/articles/8325606-what-is-the-pro-plan",monthlyUSD:20)
    ]
    static func subscription(_ provider: String) -> EnrollmentGuide? { subscriptions.first { $0.provider == provider } }
    static let googleDesktopURL = "https://antigravity.google/download"
    static let googleGettingStartedURL = "https://antigravity.google/docs/getting-started?tab=cli"
}
