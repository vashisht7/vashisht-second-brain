import AppKit
import Foundation

var shortcutIsDown = false

func observe(_ event: NSEvent) {
    let isSpace = event.keyCode == 49
    let functionIsDown = event.modifierFlags.contains(.function)
    if event.type == .keyDown && isSpace && functionIsDown && !shortcutIsDown {
        shortcutIsDown = true
        print("HOTKEY_DOWN")
        fflush(stdout)
    }
    if shortcutIsDown && ((event.type == .keyUp && isSpace) || (event.type == .flagsChanged && !functionIsDown)) {
        shortcutIsDown = false
        print("HOTKEY_UP")
        fflush(stdout)
    }
}

NSEvent.addGlobalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged]) { event in
    observe(event)
}

NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged]) { event in
    observe(event)
    return event
}

RunLoop.main.run()
