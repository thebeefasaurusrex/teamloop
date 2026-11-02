// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TeamLoopMac",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "TeamLoopMac", targets: ["TeamLoopMac"])],
    targets: [
        .executableTarget(name: "TeamLoopMac"),
        .testTarget(name: "TeamLoopMacTests", dependencies: ["TeamLoopMac"], path: "tests/TeamLoopMacTests")
    ],
    swiftLanguageVersions: [.v5]
)
