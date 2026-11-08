// Focussr's macOS sensor. Reads the Accessibility tree and speaks JSON lines over stdio.
// Other platforms implement the same protocol. See docs/ARCHITECTURE.md.
import AppKit
import ApplicationServices
import Foundation

@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError

// MARK: - Output

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

// MARK: - Accessibility helpers

func attr<T>(_ element: AXUIElement, _ name: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value as? T
}

func element(_ owner: AXUIElement, _ name: String) -> AXUIElement? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(owner, name as CFString, &value) == .success, let value,
          CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return unsafeDowncast(value, to: AXUIElement.self)
}

func children(_ owner: AXUIElement) -> [AXUIElement] {
    (attr(owner, kAXChildrenAttribute) as [AXUIElement]?) ?? []
}

func frame(_ target: AXUIElement) -> CGRect? {
    var position = CGPoint.zero
    var size = CGSize.zero
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(target, kAXPositionAttribute as CFString, &value) == .success, let value,
          AXValueGetValue(value as! AXValue, .cgPoint, &position) else { return nil }
    var sizeValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(target, kAXSizeAttribute as CFString, &sizeValue) == .success, let sizeValue,
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: position, size: size)
}

func rectJSON(_ rect: CGRect) -> [String: Double] {
    ["x": Double(rect.minX), "y": Double(rect.minY), "width": Double(rect.width), "height": Double(rect.height)]
}

func role(_ target: AXUIElement) -> String { attr(target, kAXRoleAttribute) ?? "" }

func text(_ target: AXUIElement) -> String? {
    for name in [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute] {
        if let value: String = attr(target, name), !value.isEmpty { return value }
    }
    return nil
}

func walk(_ root: AXUIElement, limit: Int, budget: TimeInterval = 1.5, visit: (AXUIElement) -> Bool) {
    var queue = [root]
    var index = 0
    let deadline = Date().addingTimeInterval(budget)
    while index < queue.count, index < limit, Date() < deadline {
        let current = queue[index]
        index += 1
        if visit(current) { return }
        queue.append(contentsOf: children(current))
    }
}

func focusedWindow(pid: pid_t) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    return element(app, kAXFocusedWindowAttribute) ?? element(app, kAXMainWindowAttribute)
}

func frontmostPid() -> pid_t? {
    let system = AXUIElementCreateSystemWide()
    if let app = element(system, kAXFocusedApplicationAttribute) {
        var pid: pid_t = 0
        if AXUIElementGetPid(app, &pid) == .success { return pid }
    }
    return NSWorkspace.shared.frontmostApplication?.processIdentifier
}

func webArea(in window: AXUIElement) -> AXUIElement? {
    var found: AXUIElement?
    walk(window, limit: 300, budget: 0.15) { node in
        if role(node) == "AXWebArea" { found = node; return true }
        return false
    }
    return found
}

func host(of web: AXUIElement?) -> String? {
    guard let web, let url: URL = attr(web, "AXURL"), let name = url.host else { return nil }
    return name.replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression)
}

let browserIDs: Set<String> = [
    "com.apple.Safari", "com.google.Chrome", "company.thebrowser.Browser", "com.brave.Browser",
    "com.microsoft.edgemac", "org.mozilla.firefox", "com.vivaldi.Vivaldi", "com.operasoftware.Opera",
]

func isOurs(_ app: NSRunningApplication) -> Bool {
    if app.processIdentifier == getpid() || app.processIdentifier == getppid() { return true }
    return app.bundleIdentifier == "dev.focussr.app" || app.bundleIdentifier == "com.github.Electron"
}

// MARK: - Scroll reading

struct Scroll { var position: Double; var viewport: Double; var visible: Bool }

func isScrollable(_ node: AXUIElement) -> Bool {
    if role(node) == "AXWebArea" { return true }
    return element(node, kAXVerticalScrollBarAttribute) != nil
}

func clamp(_ value: Double) -> Double { min(max(value, 0), 1) }

func readScrollBar(_ area: AXUIElement) -> Scroll? {
    guard let bar = element(area, kAXVerticalScrollBarAttribute),
          let raw: NSNumber = attr(bar, kAXValueAttribute), let box = frame(area) else { return nil }
    var contentHeight = 0.0
    let contents = (attr(area, kAXContentsAttribute) as [AXUIElement]?) ?? children(area)
    for child in contents where role(child) != "AXScrollBar" {
        if let rect = frame(child) { contentHeight = max(contentHeight, Double(rect.height)) }
    }
    let viewport = contentHeight > 0 ? clamp(Double(box.height) / contentHeight) : 0.2
    return Scroll(position: clamp(raw.doubleValue), viewport: viewport, visible: true)
}

/// Browsers don't always expose scroll bars, but page content keeps its real on-screen position.
func readWebArea(_ web: AXUIElement) -> Scroll? {
    guard let box = frame(web) else { return nil }
    var level = children(web)
    var depth = 0
    while level.count == 1, depth < 5 {
        level = children(level[0])
        depth += 1
    }
    var top = Double.infinity
    var bottom = -Double.infinity
    for child in level.prefix(800) {
        guard let rect = frame(child), rect.height > 0 else { continue }
        top = min(top, Double(rect.minY))
        bottom = max(bottom, Double(rect.maxY))
    }
    let height = bottom - top
    guard height > 0, top.isFinite else { return nil }
    let viewportHeight = Double(box.height)
    if height <= viewportHeight { return Scroll(position: 0, viewport: 1, visible: true) }
    return Scroll(position: clamp((Double(box.minY) - top) / (height - viewportHeight)),
                  viewport: viewportHeight / height, visible: true)
}

/// A plain box has no scroll of its own, so measure how it sits inside whatever clips it.
func readBox(_ box: AXUIElement, clip: CGRect) -> Scroll? {
    guard let rect = frame(box), rect.height > 0 else { return nil }
    let visible = rect.intersection(clip)
    if visible.isNull || visible.height < 4 { return Scroll(position: 0, viewport: 1, visible: false) }
    if rect.height <= clip.height { return Scroll(position: 0, viewport: 1, visible: true) }
    return Scroll(position: clamp(Double(clip.minY - rect.minY) / Double(rect.height - clip.height)),
                  viewport: Double(clip.height / rect.height), visible: true)
}

func readScroll(_ node: AXUIElement) -> Scroll? {
    role(node) == "AXWebArea" ? (readScrollBar(node) ?? readWebArea(node)) : readScrollBar(node)
}

/// The main reading surface of a window: the largest thing that scrolls.
func findSurface(window: AXUIElement) -> AXUIElement? {
    guard let windowFrame = frame(window) else { return nil }
    var best: AXUIElement?
    var bestArea = windowFrame.width * windowFrame.height * 0.2
    walk(window, limit: 800, budget: 0.4) { node in
        guard isScrollable(node), let rect = frame(node) else { return false }
        let area = rect.width * rect.height
        if area > bestArea { best = node; bestArea = area }
        return false
    }
    return best
}

// MARK: - Picking a box

func describe(_ node: AXUIElement) -> String {
    if let title: String = attr(node, kAXTitleAttribute), !title.isEmpty { return String(title.prefix(40)) }
    if let label: String = attr(node, kAXDescriptionAttribute), !label.isEmpty { return String(label.prefix(40)) }
    switch role(node) {
    case "AXWebArea": return "Whole page"
    case "AXScrollArea", "AXTextArea": return "Text area"
    case "AXTable", "AXOutline", "AXList": return "List"
    default: return "Section"
    }
}

/// The smallest sensible box under a point: big enough to read, never a single word.
func boxAt(_ point: CGPoint) -> (element: AXUIElement, frame: CGRect, pid: pid_t)? {
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &hit) == .success,
          var current = hit else { return nil }
    var pid: pid_t = 0
    AXUIElementGetPid(current, &pid)
    for _ in 0..<40 {
        let currentRole = role(current)
        if currentRole == "AXWindow" { return nil }
        if let rect = frame(current), rect.width >= 200, rect.height >= 80 { return (current, rect, pid) }
        guard let parent = element(current, kAXParentAttribute) else { return nil }
        current = parent
    }
    return nil
}

func clipRect(for node: AXUIElement) -> CGRect {
    var current = node
    for _ in 0..<40 {
        guard let parent = element(current, kAXParentAttribute) else { break }
        if isScrollable(parent) || role(parent) == "AXWindow", let rect = frame(parent) { return rect }
        current = parent
    }
    return CGRect(x: -100000, y: -100000, width: 200000, height: 200000)
}

final class Picker {
    var hovered: (element: AXUIElement, frame: CGRect, pid: pid_t)?
    var timer: Timer?
    var tap: CFMachPort?
    var source: CFRunLoopSource?

    func start() {
        let mask = (1 << CGEventType.leftMouseDown.rawValue) | (1 << CGEventType.keyDown.rawValue)
        tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                eventsOfInterest: CGEventMask(mask), callback: { _, type, event, _ in
            if type == .tapDisabledByTimeout { return Unmanaged.passUnretained(event) }
            if type == .keyDown {
                guard event.getIntegerValueField(.keyboardEventKeycode) == 53 else { return Unmanaged.passUnretained(event) }
                DispatchQueue.main.async { picker.finish(confirm: false) }
                return nil
            }
            DispatchQueue.main.async { picker.finish(confirm: true) }
            return nil
        }, userInfo: nil)
        guard let tap else { emit(["type": "picked", "cancelled": true]); return }
        source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        timer = Timer.scheduledTimer(withTimeInterval: 0.06, repeats: true) { [weak self] _ in self?.poll() }
    }

    func poll() {
        guard let location = CGEvent(source: nil)?.location, let box = boxAt(location) else { return }
        hovered = box
        let app = NSRunningApplication(processIdentifier: box.pid)
        emit(["type": "hover", "x": box.frame.minX, "y": box.frame.minY, "width": box.frame.width,
              "height": box.frame.height, "label": describe(box.element), "app": app?.localizedName ?? ""])
    }

    func finish(confirm: Bool) {
        timer?.invalidate()
        timer = nil
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        tap = nil
        source = nil
        guard confirm, let box = hovered, let app = NSRunningApplication(processIdentifier: box.pid),
              let window = focusedWindow(pid: box.pid), let windowFrame = frame(window) else {
            emit(["type": "picked", "cancelled": true])
            return
        }
        hovered = nil
        let web = browserIDs.contains(app.bundleIdentifier ?? "") ? webArea(in: window) : nil
        var result: [String: Any] = [
            "type": "picked", "cancelled": false, "label": describe(box.element),
            "relX": Double((box.frame.midX - windowFrame.minX) / windowFrame.width),
            "relY": Double((box.frame.midY - windowFrame.minY) / windowFrame.height),
            "name": app.localizedName ?? "App", "appId": app.bundleIdentifier ?? "", "pid": Int(box.pid),
            "title": (attr(window, kAXTitleAttribute) as String?) ?? "",
        ]
        if let name = host(of: web) { result["host"] = name }
        emit(result)
    }
}

let picker = Picker()

// MARK: - Sensor

final class Sensor {
    var attachedPid: pid_t?
    var surface: AXUIElement?
    var isBox = false
    var clip = CGRect.zero
    var relative: CGPoint?
    var lastSearch = Date.distantPast

    func attach(pid: pid_t, relative point: CGPoint?) {
        attachedPid = pid
        relative = point
        surface = nil
        lastSearch = .distantPast
        let app = AXUIElementCreateApplication(pid)
        // Chromium and Electron build their accessibility tree only when asked.
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        if browserIDs.contains(NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? "") {
            AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        }
        NSRunningApplication(processIdentifier: pid)?.activate()
    }

    func resolve() {
        guard let pid = attachedPid, let window = focusedWindow(pid: pid) else { return }
        // Only search again occasionally. A tree walk is too heavy to run four times a second.
        if surface != nil, frame(surface!) != nil, Date().timeIntervalSince(lastSearch) < 5 { return }
        lastSearch = Date()
        if let point = relative, let windowFrame = frame(window) {
            let absolute = CGPoint(x: windowFrame.minX + point.x * windowFrame.width,
                                   y: windowFrame.minY + point.y * windowFrame.height)
            if surface == nil || frame(surface!) == nil, let box = boxAt(absolute) {
                surface = box.element
            }
            if let surface {
                isBox = !isScrollable(surface)
                if isBox { clip = clipRect(for: surface) }
            }
        } else {
            surface = findSurface(window: window)
            isBox = false
        }
    }

    func tick() {
        let front = frontmostPid()
        var payload: [String: Any] = ["type": "sample", "t": Date().timeIntervalSince1970]
        if let front, let app = NSRunningApplication(processIdentifier: front), !isOurs(app) {
            var info: [String: Any] = ["name": app.localizedName ?? "", "appId": app.bundleIdentifier ?? "", "pid": Int(front)]
            if let window = focusedWindow(pid: front) {
                info["title"] = (attr(window, kAXTitleAttribute) as String?) ?? ""
                if browserIDs.contains(app.bundleIdentifier ?? ""), let name = host(of: webArea(in: window)) { info["host"] = name }
            }
            payload["frontmost"] = info
        }
        if attachedPid != nil {
            resolve()
            var scroll: Scroll?
            if let surface { scroll = isBox ? readBox(surface, clip: clipRect(for: surface)) : readScroll(surface) }
            if let scroll {
                payload["scroll"] = ["position": scroll.position, "viewport": scroll.viewport, "visible": scroll.visible]
            }
            if let rect = surface.flatMap(frame) { payload["surface"] = rectJSON(rect) }
            if let pid = attachedPid, let window = focusedWindow(pid: pid) {
                if let rect = frame(window) { payload["window"] = rectJSON(rect) }
                var windowID: CGWindowID = 0
                if _AXUIElementGetWindow(window, &windowID) == .success { payload["windowId"] = Int(windowID) }
            }
        }
        emit(payload)
    }

    func listApps(id: Any?) {
        var apps: [[String: Any]] = []
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular && !isOurs(app) {
            var info: [String: Any] = ["name": app.localizedName ?? "App", "appId": app.bundleIdentifier ?? "", "pid": Int(app.processIdentifier)]
            if let window = focusedWindow(pid: app.processIdentifier) {
                info["title"] = (attr(window, kAXTitleAttribute) as String?) ?? ""
                if browserIDs.contains(app.bundleIdentifier ?? ""), let name = host(of: webArea(in: window)) { info["host"] = name }
            }
            apps.append(info)
        }
        emit(["type": "apps", "id": id ?? NSNull(), "apps": apps])
    }

    func searchRoot() -> AXUIElement? {
        guard let pid = attachedPid ?? frontmostPid() else { return nil }
        return focusedWindow(pid: pid)
    }

    /// Finds text in the front window and scrolls it into view.
    func find(_ query: String, id: Any?) {
        var match: [String: Any] = ["type": "result", "id": id ?? NSNull(), "found": false]
        if let root = searchRoot() {
            walk(root, limit: 8000) { node in
                guard let value = text(node), let found = value.range(of: query, options: .caseInsensitive) else { return false }
                AXUIElementPerformAction(node, "AXScrollToVisible" as CFString)
                // A long text area is one element, so aim at the characters inside it.
                var range = CFRange(location: value.utf16.distance(from: value.utf16.startIndex, to: found.lowerBound), length: query.utf16.count)
                if let axRange = AXValueCreate(.cfRange, &range) {
                    AXUIElementSetAttributeValue(node, kAXVisibleCharacterRangeAttribute as CFString, axRange)
                }
                match["found"] = true
                let from = value.index(found.lowerBound, offsetBy: -60, limitedBy: value.startIndex) ?? value.startIndex
                match["snippet"] = String(value[from...].prefix(240))
                if let rect = frame(node) { match["frame"] = ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height] }
                return true
            }
        }
        emit(match)
    }

    func read(id: Any?) {
        var collected = ""
        if let root = searchRoot() {
            walk(root, limit: 8000) { node in
                if let value = text(node), ["AXStaticText", "AXTextArea", "AXTextField", "AXHeading"].contains(role(node)) {
                    collected += value + "\n"
                }
                return collected.count > 8000
            }
        }
        emit(["type": "result", "id": id ?? NSNull(), "text": String(collected.prefix(8000))])
    }
}

let sensor = Sensor()

func handle(_ line: String) {
    guard let data = line.data(using: .utf8),
          let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let name = command["cmd"] as? String else { return }
    let id = command["id"]
    switch name {
    case "list": sensor.listApps(id: id)
    case "attach":
        guard let pid = command["pid"] as? Int else { return }
        var point: CGPoint?
        if let x = command["relX"] as? Double, let y = command["relY"] as? Double { point = CGPoint(x: x, y: y) }
        sensor.attach(pid: pid_t(pid), relative: point)
    case "detach":
        sensor.attachedPid = nil
        sensor.surface = nil
    case "pick": picker.start()
    case "find": sensor.find(command["text"] as? String ?? "", id: id)
    case "read": sensor.read(id: id)
    case "activate":
        if let pid = command["pid"] as? Int { NSRunningApplication(processIdentifier: pid_t(pid))?.activate() }
    case "prompt":
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        emit(["type": "permission", "granted": AXIsProcessTrustedWithOptions(options)])
    default: break
    }
}

emit(["type": "permission", "granted": AXIsProcessTrusted()])

DispatchQueue.global().async {
    while let line = readLine() {
        DispatchQueue.main.async { handle(line) }
    }
    exit(0)
}

Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
    sensor.tick()
}
Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
    emit(["type": "permission", "granted": AXIsProcessTrusted()])
}
RunLoop.main.run()
