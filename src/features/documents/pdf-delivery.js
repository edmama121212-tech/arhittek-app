// Actions labelled "Скачать PDF" must save a local file, even when the
// operating system supports Web Share (which opens a share sheet instead).
async function deliverDocumentPdf(doc,name){
  doc.save(name);
}
