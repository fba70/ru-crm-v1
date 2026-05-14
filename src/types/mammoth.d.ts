// Minimal ambient declarations for `mammoth` — the package ships no
// TypeScript types and there is no `@types/mammoth` on DefinitelyTyped.
// Keep this narrow to what we actually use in the office parser.

declare module "mammoth" {
  export interface MammothInput {
    buffer: Buffer | Uint8Array
  }

  export interface MammothMessage {
    type: "warning" | "error"
    message: string
  }

  export interface MammothResult {
    value: string
    messages: MammothMessage[]
  }

  export function convertToHtml(input: MammothInput): Promise<MammothResult>
  export function extractRawText(input: MammothInput): Promise<MammothResult>

  const mammoth: {
    convertToHtml: typeof convertToHtml
    extractRawText: typeof extractRawText
  }
  export default mammoth
}
