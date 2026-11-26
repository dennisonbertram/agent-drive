// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AgentDriveFinder",
    platforms: [.macOS(.v13)],
    products: [.library(name: "AgentDriveFinderCore", targets: ["AgentDriveFinderCore"])],
    targets: [
        .target(name: "AgentDriveFinderCore"),
        .testTarget(name: "AgentDriveFinderCoreTests", dependencies: ["AgentDriveFinderCore"]),
    ],
)
