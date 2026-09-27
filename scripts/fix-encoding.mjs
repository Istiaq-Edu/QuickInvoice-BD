// Repairs encoding damage introduced by shell-based edits, and proves the repair.
//
// PowerShell's Set-Content wrote files as UTF-8 with a BOM and re-encoded
// already-decoded text, so a single real character (a middot, an em dash, the
// taka sign) became two or three Latin-1 characters. This reverses that
// generically: a run of Latin-1 supplement characters is mapped back to the bytes
// it came from and decoded as UTF-8.
//
// The previous version of this script hardcoded a repair table and a verification
// regex, and both were wrong. The table compared identical strings, so it repaired
// nothing. The regex only matched two-byte sequences, so three-byte damage such as
// the taka sign (E0 A7 B3 rendered as three Latin-1 characters) passed as clean. It
// therefore printed "verified: no mojibake remains" while three user-visible labels
// still displayed a damaged currency symbol. Repair and verification below now share
// one routine, so they cannot disagree.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const roots = ["app", "components", "lib", "tests", "scripts", "docs", "supabase"]
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.(ts|tsx|mjs|sql|md)$/.test(entry)) files.push(full)
  }
}
for (const root of roots) walk(root)

// Reverses one mojibake run starting at `start`. Returns null when the run does not
// decode as valid UTF-8, which is the signal that those characters are legitimate
// rather than damaged: real prose contains Latin-1 accents, and only their encoding
// is ever wrong, never their presence.
const reverseRun = (text, start) => {
  const bytes = []
  let index = start
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code < 0x80) break
    bytes.push(code)
    index += 1
  }
  if (bytes.length < 2) return null
  let decoded
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes))
  } catch {
    return null
  }
  // A C1 control or a replacement character means this was not damaged text.
  if (/[\u0080-\u009f\ufffd]/.test(decoded)) return null
  return { text: decoded, end: index }
}

const repairText = (text) => {
  let out = ""
  let at = 0
  while (at < text.length) {
    if (text.charCodeAt(at) >= 0x80) {
      const run = reverseRun(text, at)
      if (run) {
        out += run.text
        at = run.end
        continue
      }
    }
    out += text[at]
    at += 1
  }
  return out
}

const countDamage = (text) => {
  let count = 0
  let at = 0
  while (at < text.length) {
    if (text.charCodeAt(at) >= 0x80) {
      const run = reverseRun(text, at)
      if (run) {
        count += 1
        at = run.end
        continue
      }
    }
    at += 1
  }
  return count
}

let changed = 0
for (const file of files) {
  let text = readFileSync(file).toString("utf8")
  const hadBom = text.charCodeAt(0) === 0xfeff
  if (hadBom) text = text.slice(1)
  const repaired = repairText(text)
  if (repaired !== text || hadBom) {
    writeFileSync(file, repaired, "utf8")
    changed += 1
    console.log(`repaired ${file}${hadBom ? " (removed BOM)" : ""}`)
  }
}
console.log(`\n${changed} file(s) repaired`)

let remaining = 0
for (const file of files) {
  const count = countDamage(readFileSync(file, "utf8"))
  if (count > 0) {
    remaining += 1
    console.log(`STILL DAMAGED: ${file} (${count} run(s))`)
  }
}
console.log(remaining === 0 ? "verified: no mojibake remains" : `${remaining} file(s) still damaged`)
process.exitCode = remaining === 0 ? 0 : 1
