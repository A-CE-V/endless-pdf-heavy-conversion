// index.js (Split/Merge Service)
import express from "express";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import archiver from "archiver";

// Shared imports
import { addEndlessForgeMetadata } from "./utils/pdfMetadata.js";
import { verifyInternalKey } from "./shared/apiKeyMiddleware.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

app.post(
  "/pdf/merge",
  verifyInternalKey,
  upload.array("pdfs"),
  async (req, res) => {

  try {
    if (!req.files || req.files.length < 2)
      return res.status(400).json({ error: "Upload at least 2 PDFs" });

      const mergedPdf = await PDFDocument.create();
      for (const file of req.files) {
        const pdf = await PDFDocument.load(file.buffer);
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
      }
      
      await addEndlessForgeMetadata(mergedPdf);
      const mergedBytes = await mergedPdf.save();

      res.type("application/pdf");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="merged.pdf"`);
      res.send(Buffer.from(mergedBytes));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------- SPLIT PDF ---------------------
app.post(
  "/pdf/split",
  verifyInternalKey,
  upload.single("pdf"),
  async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload a PDF" });

    const pdf = await PDFDocument.load(req.file.buffer);
    const totalPages = pdf.getPageCount();

    let parts = parseInt(req.body.parts) || 0; // total number of parts
    let pagesPerSplit = parseInt(req.body.pagesPerSplit) || 0; // pages per split
    if (!parts && !pagesPerSplit) pagesPerSplit = 1;
    if (parts > 0) pagesPerSplit = Math.ceil(totalPages / parts);

    const archive = archiver("zip", { zlib: { level: 9 } });
    const originalName = req.file.originalname.replace(/\.[^/.]+$/, "");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${originalName}-by-parts.zip"`);
    archive.pipe(res);

    for (let i = 0; i < totalPages; i += pagesPerSplit) {
      const newPdf = await PDFDocument.create();
      const end = Math.min(i + pagesPerSplit, totalPages);
      const pagesToCopy = Array.from({ length: end - i }, (_, idx) => i + idx);
      const copiedPages = await newPdf.copyPages(pdf, pagesToCopy);
      copiedPages.forEach((page) => newPdf.addPage(page));
      await addEndlessForgeMetadata(newPdf);
      const pdfBytes = await newPdf.save();
      archive.append(Buffer.from(pdfBytes), { name: `part_${i / pagesPerSplit + 1}.pdf` });
    }

    await archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => res.send({ status: "OK", service: "Merge-Split-API" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Merge/Split API running on port ${PORT}`));