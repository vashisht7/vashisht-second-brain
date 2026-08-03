#!/usr/bin/env swift

import AppKit
import Foundation
import PDFKit
import Vision

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: ocr_document.swift <document>\n".utf8))
    exit(2)
}

let input = URL(fileURLWithPath: CommandLine.arguments[1])

func recognize(_ image: CGImage) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    return (request.results ?? [])
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: "\n")
}

func render(_ page: PDFPage) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let scale: CGFloat = 3.0
    let width = max(1, Int(bounds.width * scale))
    let height = max(1, Int(bounds.height * scale))
    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }
    context.setFillColor(NSColor.white.cgColor)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.saveGState()
    context.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: context)
    context.restoreGState()
    return context.makeImage()
}

do {
    var pages: [String] = []
    if input.pathExtension.lowercased() == "pdf", let document = PDFDocument(url: input) {
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index), let image = render(page) else { continue }
            pages.append(try recognize(image))
        }
    } else if let image = NSImage(contentsOf: input),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
        pages.append(try recognize(cgImage))
    } else {
        throw NSError(domain: "OCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported document"])
    }
    print(pages.joined(separator: "\n\u{000C}\n"))
} catch {
    FileHandle.standardError.write(Data("OCR failed\n".utf8))
    exit(1)
}
