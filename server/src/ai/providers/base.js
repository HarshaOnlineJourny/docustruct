// Provider interface every adapter must satisfy.
//
// All methods are optional except `name` and `extractCell`. Adapters that
// don't implement a method should throw NotImplemented so the caller can
// gracefully fall back.
export class NotImplemented extends Error {
  constructor(method) { super(`Provider does not implement ${method}`); this.code = 'NOT_IMPLEMENTED'; }
}

export class AIProvider {
  // Required: human-readable provider name (e.g. "OpenAI").
  get name() { return 'AbstractProvider'; }

  // Required: list of model IDs the provider exposes for selection in the UI.
  // Each: { id, label, contextWindow, costPer1MInput, costPer1MOutput }.
  listModels() { throw new NotImplemented('listModels'); }

  // Extract a single ambiguous cell. Inputs:
  //   { cellText, columnHeader, surroundingRow, fieldType, allowedExamples }
  // Returns: { value, confidence, raw, usage: { promptTokens, completionTokens } }
  async extractCell(_input, _config) { throw new NotImplemented('extractCell'); }

  // Suggest a starter template from a few unlabeled PDFs. Optional.
  async suggestTemplate(_pdfTextSamples, _config) { throw new NotImplemented('suggestTemplate'); }

  // Vision-based row extraction for hostile PDFs. Optional.
  async extractRowsFromImage(_pageImageBase64, _config) { throw new NotImplemented('extractRowsFromImage'); }

  // Whole-PDF vision extraction. Provider receives the PDF bytes (some
  // accept PDFs natively, others need page-image rendering upstream) and
  // returns structured records.
  async extractRecordsFromPDF(_pdfBuffer, _template, _config) { throw new NotImplemented('extractRecordsFromPDF'); }
}
