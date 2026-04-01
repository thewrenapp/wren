/*
 * Stub implementations for newer pdfium API functions that are referenced by
 * pdfium-render's static bindings but not present in libpdfium.a v6694.
 * These are never called at runtime — ferrules uses only the stable API subset.
 */

#include <stddef.h>

typedef int FPDF_BOOL;
typedef void* FPDF_DOCUMENT;
typedef void* FPDF_PAGE;
typedef void* FPDF_PAGEOBJECT;
typedef void* FPDF_PAGEOBJECTMARK;

FPDF_BOOL FPDFFormObj_RemoveObject(FPDF_PAGEOBJECT form_object, FPDF_PAGEOBJECT page_object) {
    (void)form_object; (void)page_object;
    return 0;
}

FPDF_BOOL FPDFImageObj_GetIccProfileDataDecoded(FPDF_PAGE page, FPDF_PAGEOBJECT image_object,
                                                  void* buffer, unsigned long buflen,
                                                  unsigned long* out_buflen) {
    (void)page; (void)image_object; (void)buffer; (void)buflen; (void)out_buflen;
    return 0;
}

FPDF_BOOL FPDFPageObjMark_GetParamFloatValue(FPDF_PAGEOBJECTMARK mark, const char* key,
                                               float* out_value) {
    (void)mark; (void)key; (void)out_value;
    return 0;
}

FPDF_BOOL FPDFPageObjMark_SetFloatParam(FPDF_DOCUMENT document, FPDF_PAGEOBJECT page_object,
                                          FPDF_PAGEOBJECTMARK mark, const char* key,
                                          float value) {
    (void)document; (void)page_object; (void)mark; (void)key; (void)value;
    return 0;
}

FPDF_BOOL FPDFPageObj_GetIsActive(FPDF_PAGEOBJECT page_object) {
    (void)page_object;
    return 0;
}

FPDF_BOOL FPDFPageObj_SetIsActive(FPDF_PAGEOBJECT page_object, FPDF_BOOL is_active) {
    (void)page_object; (void)is_active;
    return 0;
}
