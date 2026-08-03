import AppKit

let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)
image.lockFocus()

let canvas = NSRect(origin: .zero, size: size)
let background = NSBezierPath(roundedRect: canvas.insetBy(dx: 64, dy: 64), xRadius: 220, yRadius: 220)
let gradient = NSGradient(colors: [
    NSColor(calibratedRed: 0.08, green: 0.10, blue: 0.14, alpha: 1),
    NSColor(calibratedRed: 0.15, green: 0.20, blue: 0.27, alpha: 1),
    NSColor(calibratedRed: 0.18, green: 0.53, blue: 0.48, alpha: 1)
])!
gradient.draw(in: background, angle: -45)

NSGraphicsContext.current?.saveGraphicsState()
let ring = NSBezierPath(ovalIn: NSRect(x: 216, y: 216, width: 592, height: 592))
NSColor(calibratedWhite: 1, alpha: 0.14).setFill()
ring.fill()
let inner = NSBezierPath(ovalIn: NSRect(x: 276, y: 276, width: 472, height: 472))
NSColor(calibratedRed: 0.05, green: 0.08, blue: 0.11, alpha: 0.82).setFill()
inner.fill()
NSGraphicsContext.current?.restoreGraphicsState()

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 250, weight: .bold),
    .foregroundColor: NSColor.white,
    .paragraphStyle: paragraph,
    .kern: -15
]
NSString(string: "VD").draw(in: NSRect(x: 220, y: 360, width: 584, height: 300), withAttributes: attributes)

image.unlockFocus()
guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Unable to create icon")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
