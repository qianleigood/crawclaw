#!/usr/bin/env swift

import Foundation
import AppKit
import ApplicationServices
import CoreGraphics

struct CLI {
    enum Command: String {
        case dumpTree = "dump-tree"
        case dumpFocused = "dump-focused"
        case dumpAttributes = "dump-attributes"
        case dumpWindows = "dump-windows"
        case press = "press"
        case pressFocused = "press-focused"
        case waitOpenPanel = "wait-open-panel"
        case selectOpenPanel = "select-open-panel"
        case pressUploadAndSelect = "press-upload-and-select"
    }

    let command: Command
    let options: [String: String]
    let flags: Set<String>

    init?(_ args: [String]) {
        guard args.count >= 2, let cmd = Command(rawValue: args[1]) else { return nil }
        self.command = cmd
        var options: [String: String] = [:]
        var flags: Set<String> = []
        var i = 2
        while i < args.count {
            let arg = args[i]
            if arg.hasPrefix("--") {
                let key = String(arg.dropFirst(2))
                if i + 1 < args.count, !args[i + 1].hasPrefix("--") {
                    options[key] = args[i + 1]
                    i += 2
                } else {
                    flags.insert(key)
                    i += 1
                }
            } else {
                i += 1
            }
        }
        self.options = options
        self.flags = flags
    }

    func string(_ key: String, _ defaultValue: String) -> String { options[key] ?? defaultValue }
    func int(_ key: String, _ defaultValue: Int) -> Int { Int(options[key] ?? "") ?? defaultValue }
    func bool(_ key: String) -> Bool { flags.contains(key) }
}

enum HelperError: Error, CustomStringConvertible {
    case message(String)
    var description: String {
        switch self {
        case .message(let msg): return msg
        }
    }
}

struct ElementRecord {
    let element: AXUIElement
    let depth: Int
    let role: String
    let subrole: String
    let title: String
    let desc: String
    let value: String
    let help: String
    let identifier: String
    let actions: [String]

    var joined: String {
        [role, subrole, title, desc, value, help, identifier].joined(separator: " | ")
    }
}

let traversalAttributes = [
    kAXChildrenAttribute as String,
    kAXContentsAttribute as String,
    kAXVisibleChildrenAttribute as String,
    kAXRowsAttribute as String,
    kAXColumnsAttribute as String,
    kAXSelectedChildrenAttribute as String,
    kAXTabsAttribute as String,
    kAXLinkedUIElementsAttribute as String,
    kAXServesAsTitleForUIElementsAttribute as String,
]

func sleepMs(_ ms: Int) {
    usleep(useconds_t(ms * 1000))
}

func ensureAXTrust(prompt: Bool) -> Bool {
    if prompt {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let opts = [key: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(opts)
    }
    return AXIsProcessTrusted()
}

func runningApp(named name: String) -> NSRunningApplication? {
    let exact = NSWorkspace.shared.runningApplications.first { $0.localizedName == name }
    if let exact { return exact }
    return NSWorkspace.shared.runningApplications.first {
        ($0.localizedName ?? "").localizedCaseInsensitiveContains(name)
    }
}

func appElement(named name: String) throws -> AXUIElement {
    guard let app = runningApp(named: name) else {
        throw HelperError.message("App not running: \(name)")
    }
    return AXUIElementCreateApplication(app.processIdentifier)
}

func copyAttributeNames(_ element: AXUIElement) -> [String] {
    var namesRef: CFArray?
    let err = AXUIElementCopyAttributeNames(element, &namesRef)
    guard err == .success, let arr = namesRef as? [String] else { return [] }
    return arr
}

func copyAttributeValue(_ element: AXUIElement, _ attr: String) -> AnyObject? {
    var ref: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, attr as CFString, &ref)
    guard err == .success else { return nil }
    return ref
}

func stringValue(_ element: AXUIElement, _ attr: String) -> String {
    guard let v = copyAttributeValue(element, attr) else { return "" }
    if let s = v as? String { return s }
    if let n = v as? NSNumber { return n.stringValue }
    return ""
}

func children(of element: AXUIElement) -> [AXUIElement] {
    var out: [AXUIElement] = []
    let names = copyAttributeNames(element)
    for attr in traversalAttributes where names.contains(attr) {
        if let arr = copyAttributeValue(element, attr) as? [AXUIElement] {
            out.append(contentsOf: arr)
        }
    }
    return out
}

func supportedActions(_ element: AXUIElement) -> [String] {
    var namesRef: CFArray?
    let err = AXUIElementCopyActionNames(element, &namesRef)
    guard err == .success, let arr = namesRef as? [String] else { return [] }
    return arr
}

func elementIdentifier(_ element: AXUIElement) -> String {
    String(describing: Unmanaged.passUnretained(element).toOpaque())
}

func windows(of app: AXUIElement) -> [AXUIElement] {
    (copyAttributeValue(app, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
}

func focusedElement(of app: AXUIElement) -> AXUIElement? {
    var ref: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &ref)
    guard err == .success, let unwrapped = ref else { return nil }
    return unsafeBitCast(unwrapped, to: AXUIElement.self)
}

func bfs(app: AXUIElement, maxDepth: Int, limit: Int) -> [ElementRecord] {
    var queue: [(AXUIElement, Int)] = windows(of: app).map { ($0, 0) }
    var visited = Set<String>()
    var output: [ElementRecord] = []

    while !queue.isEmpty && output.count < limit {
        let (element, depth) = queue.removeFirst()
        let key = elementIdentifier(element)
        if visited.contains(key) { continue }
        visited.insert(key)

        let rec = ElementRecord(
            element: element,
            depth: depth,
            role: stringValue(element, kAXRoleAttribute as String),
            subrole: stringValue(element, kAXSubroleAttribute as String),
            title: stringValue(element, kAXTitleAttribute as String),
            desc: stringValue(element, kAXDescriptionAttribute as String),
            value: stringValue(element, kAXValueAttribute as String),
            help: stringValue(element, kAXHelpAttribute as String),
            identifier: stringValue(element, kAXIdentifierAttribute as String),
            actions: supportedActions(element)
        )
        output.append(rec)

        if depth < maxDepth {
            for child in children(of: element) {
                queue.append((child, depth + 1))
            }
        }
    }

    return output
}

func matches(_ record: ElementRecord, needle: String) -> Bool {
    let hay = record.joined
    return hay.localizedCaseInsensitiveContains(needle)
}

func press(_ element: AXUIElement) -> AXError {
    AXUIElementPerformAction(element, kAXPressAction as CFString)
}

func waitForOpenPanel(app: AXUIElement, timeout: Int) -> ElementRecord? {
    let deadline = Date().addingTimeInterval(TimeInterval(timeout))
    while Date() < deadline {
        let records = bfs(app: app, maxDepth: 10, limit: 800)
        if let hit = records.first(where: {
            let hay = $0.joined
            let roleHit = $0.role == kAXSheetRole as String || $0.role == kAXWindowRole as String
            let nameHit = hay.localizedCaseInsensitiveContains("打开") || hay.localizedCaseInsensitiveContains("open") || hay.localizedCaseInsensitiveContains("前往") || hay.localizedCaseInsensitiveContains("go to the folder")
            return roleHit || nameHit
        }) {
            return hit
        }
        sleepMs(200)
    }
    return nil
}

func postKey(keyCode: CGKeyCode, flags: CGEventFlags = []) {
    let source = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true)
    down?.flags = flags
    down?.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
    up?.flags = flags
    up?.post(tap: .cghidEventTap)
}

func pasteText(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    postKey(keyCode: 9, flags: [.maskCommand]) // v
}

func activate(appName: String) {
    runningApp(named: appName)?.activate()
}

func selectInOpenPanel(path: String, appName: String, timeout: Int) throws {
    guard FileManager.default.fileExists(atPath: path) else {
        throw HelperError.message("File does not exist: \(path)")
    }
    let app = try appElement(named: appName)
    guard waitForOpenPanel(app: app, timeout: timeout) != nil else {
        throw HelperError.message("Timed out waiting for an open panel in \(appName)")
    }

    activate(appName: appName)
    sleepMs(250)
    postKey(keyCode: 5, flags: [.maskCommand, .maskShift]) // cmd+shift+g
    sleepMs(500)
    pasteText(path)
    sleepMs(250)
    postKey(keyCode: 36) // return
    sleepMs(700)

    let records = bfs(app: app, maxDepth: 10, limit: 1200)
    if let openButton = records.first(where: { rec in
        let hay = rec.joined
        return hay.localizedCaseInsensitiveContains("打开") || hay.localizedCaseInsensitiveContains("open")
    }) {
        let err = press(openButton.element)
        if err == .success { return }
    }

    postKey(keyCode: 36)
}

func dumpTree(appName: String, needle: String?, maxDepth: Int, limit: Int) throws {
    let app = try appElement(named: appName)
    let records = bfs(app: app, maxDepth: maxDepth, limit: limit)
    for rec in records {
        if let needle, !needle.isEmpty, !matches(rec, needle: needle) { continue }
        print("depth=\(rec.depth) role=\(rec.role) subrole=\(rec.subrole) title=\(rec.title) desc=\(rec.desc) value=\(rec.value) id=\(rec.identifier) actions=\(rec.actions.joined(separator: ","))")
    }
}

func dumpWindows(appName: String) throws {
    let app = try appElement(named: appName)
    for (idx, win) in windows(of: app).enumerated() {
        let role = stringValue(win, kAXRoleAttribute as String)
        let subrole = stringValue(win, kAXSubroleAttribute as String)
        let title = stringValue(win, kAXTitleAttribute as String)
        let desc = stringValue(win, kAXDescriptionAttribute as String)
        let main = stringValue(win, kAXMainAttribute as String)
        let focused = stringValue(win, kAXFocusedAttribute as String)
        let actions = supportedActions(win).joined(separator: ",")
        print("window=\(idx) role=\(role) subrole=\(subrole) title=\(title) desc=\(desc) main=\(main) focused=\(focused) actions=\(actions)")
    }
}

func dumpFocused(appName: String) throws {
    let app = try appElement(named: appName)
    guard let focused = focusedElement(of: app) else {
        throw HelperError.message("No focused UI element in \(appName)")
    }
    let role = stringValue(focused, kAXRoleAttribute as String)
    let subrole = stringValue(focused, kAXSubroleAttribute as String)
    let title = stringValue(focused, kAXTitleAttribute as String)
    let desc = stringValue(focused, kAXDescriptionAttribute as String)
    let value = stringValue(focused, kAXValueAttribute as String)
    let identifier = stringValue(focused, kAXIdentifierAttribute as String)
    let actions = supportedActions(focused).joined(separator: ",")
    print("role=\(role) subrole=\(subrole) title=\(title) desc=\(desc) value=\(value) id=\(identifier) actions=\(actions)")
}

func dumpAttributes(appName: String, needle: String, maxDepth: Int, limit: Int, includeChildren: Bool) throws {
    let app = try appElement(named: appName)
    let records = bfs(app: app, maxDepth: maxDepth, limit: limit)
    guard let target = records.first(where: { matches($0, needle: needle) }) else {
        throw HelperError.message("No AX element matched: \(needle)")
    }
    let names = copyAttributeNames(target.element)
    print("MATCH role=\(target.role) subrole=\(target.subrole) title=\(target.title) desc=\(target.desc) value=\(target.value) id=\(target.identifier) actions=\(target.actions.joined(separator: ","))")
    for name in names {
        let value = copyAttributeValue(target.element, name)
        if let arr = value as? [AXUIElement] {
            print("ATTR \(name)=<AXUIElement[\(arr.count)]>")
            if includeChildren {
                for (idx, child) in arr.prefix(20).enumerated() {
                    let role = stringValue(child, kAXRoleAttribute as String)
                    let title = stringValue(child, kAXTitleAttribute as String)
                    let desc = stringValue(child, kAXDescriptionAttribute as String)
                    print("  CHILD[\(idx)] role=\(role) title=\(title) desc=\(desc)")
                }
            }
        } else if let s = value as? String {
            print("ATTR \(name)=\(s)")
        } else if let n = value as? NSNumber {
            print("ATTR \(name)=\(n)")
        } else if value != nil {
            print("ATTR \(name)=<\(type(of: value!))>")
        } else {
            print("ATTR \(name)=<nil>")
        }
    }
}

func pressFirstMatch(appName: String, needle: String, maxDepth: Int, limit: Int) throws {
    let app = try appElement(named: appName)
    let records = bfs(app: app, maxDepth: maxDepth, limit: limit)
    guard let target = records.first(where: { matches($0, needle: needle) && $0.actions.contains(kAXPressAction as String) }) else {
        throw HelperError.message("No pressable AX element matched: \(needle)")
    }
    let err = press(target.element)
    guard err == .success else {
        throw HelperError.message("AXPress failed with code: \(err.rawValue)")
    }
    print("OK pressed: \(target.joined)")
}

func pressFocusedElement(appName: String) throws {
    let app = try appElement(named: appName)
    guard let focused = focusedElement(of: app) else {
        throw HelperError.message("No focused UI element in \(appName)")
    }
    let rec = ElementRecord(
        element: focused,
        depth: 0,
        role: stringValue(focused, kAXRoleAttribute as String),
        subrole: stringValue(focused, kAXSubroleAttribute as String),
        title: stringValue(focused, kAXTitleAttribute as String),
        desc: stringValue(focused, kAXDescriptionAttribute as String),
        value: stringValue(focused, kAXValueAttribute as String),
        help: stringValue(focused, kAXHelpAttribute as String),
        identifier: stringValue(focused, kAXIdentifierAttribute as String),
        actions: supportedActions(focused)
    )
    guard rec.actions.contains(kAXPressAction as String) else {
        throw HelperError.message("Focused element is not pressable: \(rec.joined)")
    }
    let err = press(focused)
    guard err == .success else {
        throw HelperError.message("AXPress on focused element failed with code: \(err.rawValue)")
    }
    print("OK pressed focused element: \(rec.joined)")
}

func main() throws {
    guard let cli = CLI(CommandLine.arguments) else {
        let usage = """
        Usage:
          chrome_ax_helper.swift dump-tree [--app Google Chrome] [--contains 上传文件] [--max-depth 10] [--limit 300]
          chrome_ax_helper.swift dump-windows [--app Google Chrome]
          chrome_ax_helper.swift dump-focused [--app Google Chrome]
          chrome_ax_helper.swift dump-attributes --contains 上传文件 [--app Google Chrome] [--max-depth 12] [--limit 800] [--include-children]
          chrome_ax_helper.swift press --contains 上传文件 [--app Google Chrome]
          chrome_ax_helper.swift press-focused [--app Google Chrome]
          chrome_ax_helper.swift wait-open-panel [--app Google Chrome] [--timeout 15]
          chrome_ax_helper.swift select-open-panel --path /abs/file [--app Google Chrome] [--timeout 15]
          chrome_ax_helper.swift press-upload-and-select --path /abs/file --contains 上传文件 [--app Google Chrome] [--timeout 15]
          Add --prompt-accessibility to request Accessibility permission when needed.
        """
        throw HelperError.message(usage)
    }

    let prompt = cli.bool("prompt-accessibility")
    guard ensureAXTrust(prompt: prompt) else {
        throw HelperError.message("Accessibility permission not granted. Enable it for the current terminal/runtime and retry.")
    }

    let appName = cli.string("app", "Google Chrome")
    switch cli.command {
    case .dumpTree:
        try dumpTree(appName: appName, needle: cli.options["contains"], maxDepth: cli.int("max-depth", 10), limit: cli.int("limit", 300))
    case .dumpWindows:
        try dumpWindows(appName: appName)
    case .dumpFocused:
        try dumpFocused(appName: appName)
    case .dumpAttributes:
        let needle = cli.string("contains", "上传文件")
        try dumpAttributes(appName: appName, needle: needle, maxDepth: cli.int("max-depth", 12), limit: cli.int("limit", 800), includeChildren: cli.bool("include-children"))
    case .press:
        let needle = cli.string("contains", "上传文件")
        try pressFirstMatch(appName: appName, needle: needle, maxDepth: cli.int("max-depth", 12), limit: cli.int("limit", 800))
    case .pressFocused:
        try pressFocusedElement(appName: appName)
    case .waitOpenPanel:
        let app = try appElement(named: appName)
        if let hit = waitForOpenPanel(app: app, timeout: cli.int("timeout", 15)) {
            print("OPEN_PANEL_DETECTED \(hit.joined)")
        } else {
            throw HelperError.message("Timed out waiting for an open panel in \(appName)")
        }
    case .selectOpenPanel:
        let path = cli.string("path", "")
        if path.isEmpty { throw HelperError.message("Missing --path") }
        try selectInOpenPanel(path: path, appName: appName, timeout: cli.int("timeout", 15))
        print("OK selected file in open panel")
    case .pressUploadAndSelect:
        let path = cli.string("path", "")
        if path.isEmpty { throw HelperError.message("Missing --path") }
        let needle = cli.string("contains", "上传文件")
        try pressFirstMatch(appName: appName, needle: needle, maxDepth: cli.int("max-depth", 12), limit: cli.int("limit", 800))
        try selectInOpenPanel(path: path, appName: appName, timeout: cli.int("timeout", 15))
        print("OK pressed upload trigger and selected file")
    }
}

do {
    try main()
} catch {
    fputs("ERROR: \(error)\n", stderr)
    exit(1)
}
