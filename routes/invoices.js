// const { v4: uuidv4 } = require("uuid");
// const PDFDocument = require("pdfkit");
// const express = require("express");
// const { body, validationResult, query } = require("express-validator");
// const { pool } = require("../config/database");
// const { authenticateToken } = require("../middleware/auth");
// const { generateInvoiceNumber } = require("../utils/helpers");

// const router = express.Router();

// const sanitizeParams = (...params) => {
//   return params.map((param) => (param === undefined ? null : param));
// };

// const toSqlDate = (value) => {
//   if (!value) return null;
//   const d = value instanceof Date ? value : new Date(value);
//   if (Number.isNaN(d.getTime())) return null;
//   const y = d.getFullYear();
//   const m = String(d.getMonth() + 1).padStart(2, "0");
//   const day = String(d.getDate()).padStart(2, "0");
//   return `${y}-${m}-${day}`;
// };

// const handleValidation = (req, res) => {
//   const errors = validationResult(req);
//   if (!errors.isEmpty()) {
//     res.status(400).json({ error: "Validation failed", details: errors.array() });
//     return true;
//   }
//   return false;
// };

// const invoiceFieldMap = {
//   customerId: "customer_id",
//   amount: "amount",
//   tax: "tax",
//   total: "total",
//   status: "status",
//   issueDate: "issue_date",
//   dueDate: "due_date",
//   paidDate: "paid_date",
//   notes: "notes",
// };

// const buildInvoiceFromCustomer = (customer, body) => {
//   const { amount, tax, total, status, issueDate, dueDate, notes, items } = body;

//   let derivedAmount = amount;
//   if (derivedAmount === undefined && Array.isArray(items)) {
//     derivedAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
//   }

//   const defaultTaxRate = customer.default_tax_rate ?? 0;
//   const finalAmount = Number(derivedAmount || 0);
//   const finalTax = tax !== undefined ? Number(tax) : defaultTaxRate || 0;
//   const finalTotal = total !== undefined ? Number(total) : finalAmount + (finalAmount * finalTax) / 100;

//   let finalIssueDate;
//   if (issueDate) {
//     finalIssueDate = toSqlDate(issueDate);
//   } else {
//     finalIssueDate = toSqlDate(new Date());
//   }

//   let finalDueDate;
//   if (dueDate) {
//     finalDueDate = toSqlDate(dueDate);
//   } else {
//     const dueDays = customer.default_due_days ?? 7;
//     const d = new Date();
//     d.setDate(d.getDate() + Number(dueDays));
//     finalDueDate = toSqlDate(d);
//   }

//   const finalStatus = status || "draft";
//   const finalNotes = notes ?? customer.default_invoice_notes ?? null;

//   return {
//     amount: finalAmount,
//     tax: finalTax,
//     total: finalTotal,
//     status: finalStatus,
//     issueDate: finalIssueDate,
//     dueDate: finalDueDate,
//     notes: finalNotes,
//   };
// };

// const ensureCanAccessInvoice = async (req, res, invoiceId) => {
//   if (req.user.role === "admin") return { ok: true };

//   const [rows] = await pool.execute(
//     `SELECT i.id FROM invoices i INNER JOIN customers c ON i.customer_id = c.id WHERE i.id = ? AND c.assigned_to = ?`,
//     sanitizeParams(invoiceId, req.user.userId)
//   );

//   if (rows.length === 0) {
//     return {
//       ok: false,
//       response: res.status(403).json({ error: "You do not have permission to access this invoice" }),
//     };
//   }
//   return { ok: true };
// };

// // Get all invoices
// router.get("/", authenticateToken, async (req, res) => {
//   try {
//     if (handleValidation(req, res)) return;

//     const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
//     const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
//     const offset = (page - 1) * limit;

//     const { search, status, customerId, dueDateFrom, dueDateTo } = req.query;

//     let whereClause = "WHERE 1=1";
//     const queryParams = [];

//     if (req.user.role !== "admin") {
//       whereClause += " AND c.assigned_to = ?";
//       queryParams.push(req.user.userId);
//     }

//     if (search) {
//       whereClause += " AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.company LIKE ?)";
//       const searchTerm = `%${search}%`;
//       queryParams.push(searchTerm, searchTerm, searchTerm);
//     }

//     if (status) {
//       whereClause += " AND i.status = ?";
//       queryParams.push(status);
//     }

//     if (customerId) {
//       whereClause += " AND i.customer_id = ?";
//       queryParams.push(customerId);
//     }

//     if (dueDateFrom) {
//       whereClause += " AND i.due_date >= ?";
//       queryParams.push(dueDateFrom);
//     }

//     if (dueDateTo) {
//       whereClause += " AND i.due_date <= ?";
//       queryParams.push(dueDateTo);
//     }

//     const invoicesSql = `
//       SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email
//       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
//       ${whereClause} ORDER BY i.created_at DESC LIMIT ${limit} OFFSET ${offset}
//     `;

//     const [invoices] = await pool.execute(invoicesSql, sanitizeParams(...queryParams));

//     const countSql = `SELECT COUNT(*) AS total FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id ${whereClause}`;
//     const [countResult] = await pool.execute(countSql, sanitizeParams(...queryParams));

//     const total = countResult[0]?.total || 0;
//     const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

//     res.json({
//       invoices,
//       pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
//     });
//   } catch (error) {
//     console.error("Invoices fetch error:", error);
//     res.status(500).json({ error: "Failed to fetch invoices" });
//   }
// });

// //pdf testing
// router.post("/:id/download", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { logoBase64 } = req.body;

//     // Fetch invoice data
//     const [invoices] = await pool.execute(
//       `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
//        c.company AS customer_company, c.address AS customer_address, c.city AS customer_city,
//        c.state AS customer_state, c.zip_code AS customer_zip_code, c.country AS customer_country
//        FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
//       sanitizeParams(id)
//     );

//     if (invoices.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" });
//     }

//     const [items] = await pool.execute(
//       "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//       sanitizeParams(id)
//     );

//     const invoice = invoices[0];
//     const subtotal = Number(invoice.amount || 0);
//     const gstRate = Number(invoice.tax || 18);
//     const gstAmount = (subtotal * gstRate) / 100;
//     const totalWithGst = Number(invoice.total || (subtotal + gstAmount));

//     const formatDate = (value) => {
//       if (!value) {
//         const now = new Date();
//         return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
//       }
//       const d = new Date(value);
//       if (Number.isNaN(d.getTime())) {
//         const now = new Date();
//         return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
//       }
//       return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
//     };

//     // FIX: Helper function to format currency properly
//     const formatCurrency = (amount) => {
//       return `Rs. ${Number(amount).toFixed(2)}`;
//     };

//     // Create PDF with proper margins - A4 size is 595.28 x 841.89 points
//     const doc = new PDFDocument({ 
//       size: 'A4', 
//       margin: 40,
//       bufferPages: true 
//     });
    
//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
//     doc.pipe(res);

//     // PROFESSIONAL COLOR PALETTE
//     const brandPrimary = '#1E3A8A';
//     const brandSecondary = '#3B82F6';
//     const accentGold = '#F59E0B';
//     const textDark = '#1F2937';
//     const textGray = '#6B7280';
//     const bgLight = '#F9FAFB';
//     const borderGray = '#E5E7EB';

//     // Page dimensions (A4 with 40pt margins)
//     const pageWidth = 595.28;
//     const pageHeight = 841.89;
//     const marginLeft = 40;
//     const marginRight = 40;
//     const contentWidth = pageWidth - marginLeft - marginRight; // 515.28
    
//     let currentY = 40;

//     // ============ LOGO SECTION ============
//     if (logoBase64) {
//       try {
//         let imageData = logoBase64;
//         if (logoBase64.includes(',')) {
//           imageData = logoBase64.split(',')[1];
//         }
        
//         const logoBuffer = Buffer.from(imageData, 'base64');
        
//         doc.image(logoBuffer, marginLeft, currentY, { 
//           width: 120,
//           height: 45,
//           fit: [120, 45],
//           align: 'left'
//         });
        
//         currentY += 55;
//       } catch (logoError) {
//         console.error("Error adding logo:", logoError);
//         currentY += 15;
//       }
//     } else {
//       currentY += 15;
//     }

//     // ============ COMPANY ADDRESS BELOW LOGO ============
//     const companyAddress = 'Dani Sanjay Apartment, 102, near Datta Mandir Road, beside Dutta mandir, Kandivali, Veena Sitar, Dahanukar Wadi, Kandivali West, Mumbai, Maharashtra 400067';
    
//     doc.fontSize(8)
//        .font('Helvetica')
//        .fillColor(textGray)
//        .text(companyAddress, marginLeft, currentY, { 
//          width: 350,
//          lineGap: 2,
//          align: 'left'
//        });
    
//     const addressHeight = doc.heightOfString(companyAddress, { width: 350, lineGap: 2 });
//     currentY += addressHeight + 15;

//     // ============ INVOICE TITLE & LINE ============
//     doc.fontSize(26)
//        .font('Helvetica-Bold')
//        .fillColor(brandPrimary)
//        .text('INVOICE', marginLeft, currentY, { 
//          align: 'center', 
//          width: contentWidth 
//        });
    
//     currentY += 32;
    
//     doc.moveTo(marginLeft, currentY)
//        .lineTo(pageWidth - marginRight, currentY)
//        .strokeColor(brandSecondary)
//        .lineWidth(2.5)
//        .stroke();
    
//     currentY += 20;

//     // ============ TWO-COLUMN LAYOUT: BILL TO & INVOICE DETAILS ============
//     const leftColX = marginLeft;
//     const leftColWidth = 260;
//     const rightColX = marginLeft + leftColWidth + 20;
//     const rightColWidth = contentWidth - leftColWidth - 20;
//     const startY = currentY;
    
//     // LEFT COLUMN - BILL TO
//     doc.fontSize(9)
//        .font('Helvetica-Bold')
//        .fillColor(brandPrimary)
//        .text('BILL TO:', leftColX, startY);
    
//     let leftY = startY + 16;
    
//     // Customer name
//     doc.fontSize(12)
//        .font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text(invoice.customer_name || 'Customer Name', leftColX, leftY, { 
//          width: leftColWidth,
//          lineGap: 1
//        });
//     leftY += 16;
    
//     // Company name
//     if (invoice.customer_company) {
//       doc.fontSize(10)
//          .font('Helvetica')
//          .fillColor(textGray)
//          .text(invoice.customer_company, leftColX, leftY, { 
//            width: leftColWidth,
//            lineGap: 1
//          });
//       leftY += 14;
//     }
    
//     // Email
//     if (invoice.customer_email) {
//       doc.fontSize(8.5)
//          .font('Helvetica')
//          .fillColor(textGray)
//          .text(`Email: ${invoice.customer_email}`, leftColX, leftY, { 
//            width: leftColWidth,
//            lineGap: 1
//          });
//       leftY += 12;
//     }
    
//     // Phone
//     if (invoice.customer_phone) {
//       doc.fontSize(8.5)
//          .text(`Phone: ${invoice.customer_phone}`, leftColX, leftY, { 
//            width: leftColWidth,
//            lineGap: 1
//          });
//       leftY += 12;
//     }
    
//     // Address - PROPERLY FORMATTED WITH WRAPPING
//     const addressParts = [
//       invoice.customer_address,
//       invoice.customer_city,
//       invoice.customer_state,
//       invoice.customer_zip_code,
//       invoice.customer_country
//     ].filter(Boolean);
    
//     if (addressParts.length > 0) {
//       const fullAddress = addressParts.join(', ');
//       doc.fontSize(8.5)
//          .font('Helvetica')
//          .fillColor(textGray)
//          .text(fullAddress, leftColX, leftY, { 
//            width: leftColWidth,
//            lineGap: 2,
//            align: 'left'
//          });
//       const addressHeight = doc.heightOfString(fullAddress, { width: leftColWidth, lineGap: 2 });
//       leftY += addressHeight + 6;
//     }
    
//     // RIGHT COLUMN - INVOICE DETAILS (FIX: Better spacing and layout)
//     let rightY = startY;
    
//     // Invoice Number
//     doc.fontSize(9)
//        .font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text('Invoice :', rightColX, rightY);
//     rightY += 12;
//     doc.fontSize(9)
//        .font('Helvetica')
//        .fillColor(brandPrimary)
//        .text(invoice.invoice_number || 'N/A', rightColX, rightY);
//     rightY += 18;
    
//     // Issue Date
//     doc.fontSize(9)
//        .font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text('Issue Date:', rightColX, rightY);
//     rightY += 12;
//     doc.fontSize(9)
//        .font('Helvetica')
//        .fillColor(textGray)
//        .text(formatDate(invoice.issue_date || invoice.created_at), rightColX, rightY);
//     rightY += 18;
    
//     // Due Date
//     doc.fontSize(9)
//        .font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text('Due Date:', rightColX, rightY);
//     rightY += 12;
//     doc.fontSize(9)
//        .font('Helvetica')
//        .fillColor(textGray)
//        .text(formatDate(invoice.due_date), rightColX, rightY);
//     rightY += 18;
    
//     // Status
//     const statusColors = {
//       'paid': '#10B981',
//       'pending': '#F59E0B',
//       'overdue': '#EF4444',
//       'draft': '#6B7280',
//       'sent': '#3B82F6'
//     };
//     const statusColor = statusColors[invoice.status] || textGray;
    
//     doc.fontSize(9)
//        .font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text('Status:', rightColX, rightY);
//     rightY += 12;
//     doc.fontSize(9)
//        .font('Helvetica-Bold')
//        .fillColor(statusColor)
//        .text((invoice.status || 'DRAFT').toUpperCase(), rightColX, rightY);
//     rightY += 10;
    
//     currentY = Math.max(leftY, rightY) + 20;
    
//     // ============ ITEMS TABLE ============
//     const tableTop = currentY;
//     const tableLeft = marginLeft;
//     const tableWidth = contentWidth;
    
//     // FIX: YELLOW - Increased column widths to prevent overlapping
//     const colSrWidth = 35;
//     const colAmountWidth = 110; // Increased from 100 to 110
//     const colDescWidth = tableWidth - colSrWidth - colAmountWidth;
    
//     const colSrX = tableLeft;
//     const colDescX = tableLeft + colSrWidth;
//     const colAmountX = tableLeft + colSrWidth + colDescWidth;
    
//     // Table Header
//     doc.rect(tableLeft, tableTop, tableWidth, 30) // Increased height from 28 to 30
//        .fillAndStroke(bgLight, borderGray);
    
//     doc.fontSize(9)
//        .font('Helvetica-Bold')
//        .fillColor(brandPrimary);
    
//     // Header: Sr. No
//     doc.text('Sr.', colSrX + 4, tableTop + 10, { 
//       width: colSrWidth - 8, 
//       align: 'center' 
//     });
    
//     // Header: Description
//     doc.text('Service / Description', colDescX + 8, tableTop + 10, { 
//       width: colDescWidth - 16,
//       align: 'left'
//     });
    
//     // FIX: YELLOW & BLUE - Changed to "Amount (Rs.)" and increased padding
//     doc.text('Amount (Rs.)', colAmountX + 10, tableTop + 10, { 
//       width: colAmountWidth - 20, // More padding on both sides
//       align: 'right' 
//     });
    
//     let rowY = tableTop + 30;
    
//     // Table Rows
//     doc.fontSize(9)
//        .font('Helvetica')
//        .fillColor(textDark);
    
//     if (items && items.length > 0) {
//       items.forEach((item, idx) => {
//         const rowHeight = 30; // Increased from 28 to 30
        
//         // Alternate row background
//         if (idx % 2 === 1) {
//           doc.rect(tableLeft, rowY, tableWidth, rowHeight)
//              .fill('#FAFAFA');
//         }
        
//         doc.fillColor(textDark);
        
//         // Serial number
//         doc.fontSize(9)
//            .font('Helvetica')
//            .text((idx + 1).toString(), colSrX + 4, rowY + 10, { 
//              width: colSrWidth - 8, 
//              align: 'center' 
//            });
        
//         // Description
//         doc.text(item.description || 'Service', colDescX + 8, rowY + 10, { 
//           width: colDescWidth - 16,
//           align: 'left'
//         });
        
//         // FIX: YELLOW & BLUE - Amount with proper formatting and spacing
//         doc.font('Helvetica-Bold')
//            .text(Number(item.amount || 0).toFixed(2), colAmountX + 10, rowY + 10, { 
//              width: colAmountWidth - 20, // More padding
//              align: 'right' 
//            });
        
//         doc.font('Helvetica');
//         rowY += rowHeight;
//       });
//     } else {
//       // Default row
//       doc.fontSize(9)
//          .font('Helvetica')
//          .text('1', colSrX + 4, rowY + 10, { 
//            width: colSrWidth - 8, 
//            align: 'center' 
//          });
//       doc.text('Service Charges', colDescX + 8, rowY + 10, { 
//         width: colDescWidth - 16 
//       });
//       doc.font('Helvetica-Bold')
//          .text(subtotal.toFixed(2), colAmountX + 10, rowY + 10, { 
//            width: colAmountWidth - 20, 
//            align: 'right' 
//          });
//       doc.font('Helvetica');
//       rowY += 30;
//     }
    
//     // Table bottom border
//     doc.moveTo(tableLeft, rowY)
//        .lineTo(tableLeft + tableWidth, rowY)
//        .strokeColor(borderGray)
//        .lineWidth(1)
//        .stroke();
    
//     rowY += 20;
    
//     // ============ TOTALS SECTION ============
//     const totalsStartX = pageWidth - marginRight - 240; // Increased from 220
//     const labelX = totalsStartX;
//     const valueX = pageWidth - marginRight - 90; // Adjusted for more space
//     const valueWidth = 80; // Increased from 70
    
//     // FIX: BLUE - Using "Rs." instead of ₹ symbol
//     // Subtotal
//     doc.fontSize(10)
//        .font('Helvetica')
//        .fillColor(textDark)
//        .text('Subtotal:', labelX, rowY, { width: 145, align: 'left' });
//     doc.font('Helvetica-Bold')
//        .text(formatCurrency(subtotal), valueX, rowY, { 
//          width: valueWidth, 
//          align: 'right' 
//        });
//     rowY += 16;
    
//     // GST
//     doc.font('Helvetica')
//        .fillColor(accentGold)
//        .text(`GST (${gstRate}%):`, labelX, rowY, { width: 145, align: 'left' });
//     doc.font('Helvetica-Bold')
//        .fillColor(accentGold)
//        .text(formatCurrency(gstAmount), valueX, rowY, { 
//          width: valueWidth, 
//          align: 'right' 
//        });
//     rowY += 16;
    
//     // Divider line
//     doc.moveTo(labelX, rowY)
//        .lineTo(pageWidth - marginRight, rowY)
//        .strokeColor(borderGray)
//        .lineWidth(1)
//        .stroke();
//     rowY += 10;
    
//     // FIX: YELLOW & BLUE - Total with more space and proper formatting
//     const boxHeight = 35; // Reduced from 38
//     const boxWidth = 245;
//     doc.rect(labelX - 5, rowY - 5, boxWidth, boxHeight)
//        .fillAndStroke('#EEF2FF', brandSecondary);
    
//     doc.fontSize(11)
//        .font('Helvetica-Bold')
//        .fillColor(brandPrimary)
//        .text('Total Payable:', labelX, rowY + 10, { width: 140, align: 'left' });
    
//     doc.fontSize(13)
//        .font('Helvetica-Bold')
//        .fillColor(brandPrimary)
//        .text(formatCurrency(totalWithGst), valueX - 5, rowY + 9, { 
//          width: valueWidth + 5, 
//          align: 'right' 
//        });
    
//     rowY += boxHeight + 15;
    
//     // ============ NOTES SECTION ============
//     if (invoice.notes && invoice.notes.trim()) {
//       // Only add notes if there's enough space on the page
//       if (rowY < pageHeight - 150) {
//         doc.fontSize(10)
//            .font('Helvetica-Bold')
//            .fillColor(textDark)
//            .text('Notes:', marginLeft, rowY);
//         rowY += 14;
        
//         doc.fontSize(9)
//            .font('Helvetica')
//            .fillColor(textGray)
//            .text(invoice.notes.trim(), marginLeft, rowY, { 
//              width: contentWidth,
//              align: 'left',
//              lineGap: 2
//            });
//       }
//     }
    
//     // ============ FOOTER ============
//     const footerY = pageHeight - 60;
    
//     doc.fontSize(9)
//        .font('Helvetica')
//        .fillColor(textGray)
//        .text('Thank you for your business!', marginLeft, footerY, { 
//          align: 'center', 
//          width: contentWidth 
//        });
    
//     doc.fontSize(7.5)
//        .fillColor('#9CA3AF')
//        .text(`Generated on ${new Date().toLocaleDateString('en-IN', {
//          day: '2-digit',
//          month: '2-digit',
//          year: 'numeric'
//        })}`, marginLeft, footerY + 14, { 
//          align: 'center', 
//          width: contentWidth 
//        });

//     doc.end();
//   } catch (error) {
//     console.error("Invoice PDF generation error:", error);
//     if (!res.headersSent) {
//       res.status(500).json({ 
//         error: "Failed to generate invoice PDF", 
//         details: error.message 
//       });
//     }
//   }
// });
// router.post("/", authenticateToken, [
//   body("customerId").notEmpty().withMessage("Customer ID is required"),
//   body("items").isArray({ min: 1 }).withMessage("Items array required"),
// ], async (req, res) => {
//   try {
//     if (handleValidation(req, res)) return;

//     const { customerId, items } = req.body;
    
//     const [customers] = await pool.execute(
//       `SELECT id, assigned_to, default_tax_rate, default_due_days, default_invoice_notes FROM customers WHERE id = ?`,
//       sanitizeParams(customerId)
//     );

//     if (customers.length === 0) {
//       return res.status(400).json({ error: "Customer not found" });
//     }

//     const customer = customers[0];

//     if (req.user.role !== "admin" && customer.assigned_to !== req.user.userId) {
//       return res.status(403).json({ error: "You do not have permission to invoice this customer" });
//     }

//     const built = buildInvoiceFromCustomer(customer, req.body);
//     const invoiceNumber = generateInvoiceNumber();
//     const invoiceId = uuidv4();

//     const connection = await pool.getConnection();
//     await connection.beginTransaction();

//     try {
//       try {
//         await connection.execute(
//           `INSERT INTO invoices (id, customer_id, invoice_number, amount, tax, total, status, issue_date, due_date, notes)
//            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(
//             invoiceId, customerId, invoiceNumber, built.amount, built.tax, built.total, built.status, built.issueDate, built.dueDate, built.notes
//           )
//         );
//       } catch (insertError) {
//         console.error("Error with issue_date, trying without:", insertError);
//         await connection.execute(
//           `INSERT INTO invoices (id, customer_id, invoice_number, amount, tax, total, status, due_date, notes)
//            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(invoiceId, customerId, invoiceNumber, built.amount, built.tax, built.total, built.status, built.dueDate, built.notes)
//         );
//       }

//       for (const item of items) {
//         await connection.execute(
//           `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(uuidv4(), invoiceId, item.description, item.quantity, item.rate, item.amount)
//         );
//       }

//       await connection.commit();

//       const [createdInvoices] = await connection.execute(
//         `SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email
//          FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
//         sanitizeParams(invoiceId)
//       );

//       const [invoiceItems] = await connection.execute(
//         "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//         sanitizeParams(invoiceId)
//       );

//       const invoice = createdInvoices[0];
//       invoice.items = invoiceItems;

//       res.status(201).json({ message: "Invoice created successfully", invoice });
//     } catch (err) {
//       await connection.rollback();
//       throw err;
//     } finally {
//       connection.release();
//     }
//   } catch (error) {
//     console.error("Invoice creation error:", error);
//     res.status(500).json({ error: "Failed to create invoice", details: error.message });
//   }
// });

// // Update, delete, stats routes remain the same...
// router.put("/:id", authenticateToken, async (req, res) => {
//   try {
//     if (handleValidation(req, res)) return;

//     const { id } = req.params;
//     const updateData = { ...req.body };

//     const access = await ensureCanAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [existingInvoices] = await pool.execute("SELECT id, status, customer_id FROM invoices WHERE id = ?", sanitizeParams(id));
//     if (existingInvoices.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" });
//     }

//     if (updateData.dueDate) updateData.dueDate = toSqlDate(updateData.dueDate);
//     if (updateData.paidDate) updateData.paidDate = toSqlDate(updateData.paidDate);

//     const connection = await pool.getConnection();
//     await connection.beginTransaction();

//     try {
//       const updateFields = [];
//       const updateValues = [];

//       Object.entries(updateData).forEach(([key, value]) => {
//         if (key === "items" || value === undefined) return;
//         const dbField = invoiceFieldMap[key];
//         if (!dbField) return;
//         updateFields.push(`${dbField} = ?`);
//         updateValues.push(value);
//       });

//       if (updateFields.length > 0) {
//         updateValues.push(id);
//         await connection.execute(
//           `UPDATE invoices SET ${updateFields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
//           sanitizeParams(...updateValues)
//         );
//       }

//       if (Array.isArray(updateData.items)) {
//         await connection.execute("DELETE FROM invoice_items WHERE invoice_id = ?", sanitizeParams(id));
//         for (const item of updateData.items) {
//           await connection.execute(
//             `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)`,
//             sanitizeParams(uuidv4(), id, item.description, item.quantity, item.rate, item.amount)
//           );
//         }
//       }

//       await connection.commit();

//       const [invoices] = await connection.execute(
//         `SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email
//          FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
//         sanitizeParams(id)
//       );

//       const [invoiceItems] = await connection.execute(
//         "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//         sanitizeParams(id)
//       );

//       const invoice = invoices[0];
//       invoice.items = invoiceItems;

//       res.json({ message: "Invoice updated successfully", invoice });
//     } catch (err) {
//       await connection.rollback();
//       throw err;
//     } finally {
//       connection.release();
//     }
//   } catch (error) {
//     console.error("Invoice update error:", error);
//     res.status(500).json({ error: "Failed to update invoice" });
//   }
// });

// router.delete("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const access = await ensureCanAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [existing] = await pool.execute("SELECT id FROM invoices WHERE id = ?", sanitizeParams(id));
//     if (existing.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" });
//     }

//     await pool.execute("DELETE FROM invoices WHERE id = ?", sanitizeParams(id));
//     res.json({ message: "Invoice deleted successfully" });
//   } catch (error) {
//     console.error("Invoice deletion error:", error);
//     res.status(500).json({ error: "Failed to delete invoice" });
//   }
// });

// router.get("/stats/overview", authenticateToken, async (req, res) => {
//   try {
//     let whereClause = "WHERE 1=1";
//     const params = [];

//     if (req.user.role !== "admin") {
//       whereClause += " AND c.assigned_to = ?";
//       params.push(req.user.userId);
//     }

//     const [stats] = await pool.execute(
//       `SELECT i.status, COUNT(*) AS count, SUM(i.total) AS total_amount FROM invoices i
//        LEFT JOIN customers c ON i.customer_id = c.id ${whereClause} GROUP BY i.status`,
//       sanitizeParams(...params)
//     );

//     const [monthlyStats] = await pool.execute(
//       `SELECT DATE_FORMAT(i.created_at, '%Y-%m') AS month, COUNT(*) AS count, SUM(i.total) AS total_amount
//        FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
//        ${whereClause} AND i.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
//        GROUP BY DATE_FORMAT(i.created_at, '%Y-%m') ORDER BY month`,
//       sanitizeParams(...params)
//     );

//     const [overdueInvoices] = await pool.execute(
//       `SELECT COUNT(*) AS count, SUM(i.total) AS total_amount FROM invoices i
//        LEFT JOIN customers c ON i.customer_id = c.id
//        ${whereClause} AND i.status IN ('sent', 'overdue') AND i.due_date < CURDATE()`,
//       sanitizeParams(...params)
//     );

//     res.json({
//       statusBreakdown: stats,
//       monthlyTrend: monthlyStats,
//       overdue: overdueInvoices[0],
//     });
//   } catch (error) {
//     console.error("Invoice stats error:", error);
//     res.status(500).json({ error: "Failed to fetch invoice statistics" });
//   }
// });

// module.exports = router;



//testing 26-12-2025



// const { v4: uuidv4 } = require("uuid");
// const PDFDocument = require("pdfkit");
// const express = require("express");
// const { body, validationResult, query } = require("express-validator");
// const { pool } = require("../config/database");
// const { authenticateToken } = require("../middleware/auth");
// const { generateInvoiceNumber } = require("../utils/helpers");

// const router = express.Router();

// const sanitizeParams = (...params) => {
//   return params.map((param) => (param === undefined ? null : param));
// };

// const toSqlDate = (value) => {
//   if (!value) return null;
//   const d = value instanceof Date ? value : new Date(value);
//   if (Number.isNaN(d.getTime())) return null;
//   const y = d.getFullYear();
//   const m = String(d.getMonth() + 1).padStart(2, "0");
//   const day = String(d.getDate()).padStart(2, "0");
//   return `${y}-${m}-${day}`;
// };

// const handleValidation = (req, res) => {
//   const errors = validationResult(req);
//   if (!errors.isEmpty()) {
//     res.status(400).json({ error: "Validation failed", details: errors.array() });
//     return true;
//   }
//   return false;
// };

// const invoiceFieldMap = {
//   customerId: "customer_id",
//   amount: "amount",
//   tax: "tax",
//   total: "total",
//   status: "status",
//   issueDate: "issue_date",
//   dueDate: "due_date",
//   paidDate: "paid_date",
//   notes: "notes",
// };

// const buildInvoiceFromCustomer = (customer, body) => {
//   const { amount, tax, total, status, issueDate, dueDate, notes, items } = body;

//   let derivedAmount = amount;
//   if (derivedAmount === undefined && Array.isArray(items)) {
//     derivedAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
//   }

//   const defaultTaxRate = customer.default_tax_rate ?? 0;
//   const finalAmount = Number(derivedAmount || 0);
//   const finalTax = tax !== undefined ? Number(tax) : defaultTaxRate || 0;
//   const finalTotal = total !== undefined ? Number(total) : finalAmount + (finalAmount * finalTax) / 100;

//   let finalIssueDate;
//   if (issueDate) {
//     finalIssueDate = toSqlDate(issueDate);
//   } else {
//     finalIssueDate = toSqlDate(new Date());
//   }

//   let finalDueDate;
//   if (dueDate) {
//     finalDueDate = toSqlDate(dueDate);
//   } else {
//     const dueDays = customer.default_due_days ?? 7;
//     const d = new Date();
//     d.setDate(d.getDate() + Number(dueDays));
//     finalDueDate = toSqlDate(d);
//   }

//   const finalStatus = status || "draft";
//   const finalNotes = notes ?? customer.default_invoice_notes ?? null;

//   return {
//     amount: finalAmount,
//     tax: finalTax,
//     total: finalTotal,
//     status: finalStatus,
//     issueDate: finalIssueDate,
//     dueDate: finalDueDate,
//     notes: finalNotes,
//   };
// };

// const ensureCanAccessInvoice = async (req, res, invoiceId) => {
//   if (req.user.role === "admin") return { ok: true };

//   const [rows] = await pool.execute(
//     `SELECT i.id FROM invoices i INNER JOIN customers c ON i.customer_id = c.id WHERE i.id = ? AND c.assigned_to = ?`,
//     sanitizeParams(invoiceId, req.user.userId)
//   );

//   if (rows.length === 0) {
//     return {
//       ok: false,
//       response: res.status(403).json({ error: "You do not have permission to access this invoice" }),
//     };
//   }
//   return { ok: true };
// };

// // Get all invoices
// router.get("/", authenticateToken, async (req, res) => {
//   try {
//     if (handleValidation(req, res)) return;

//     const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
//     const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
//     const offset = (page - 1) * limit;

//     const { search, status, customerId, dueDateFrom, dueDateTo } = req.query;

//     let whereClause = "WHERE 1=1";
//     const queryParams = [];

//     if (req.user.role !== "admin") {
//       whereClause += " AND c.assigned_to = ?";
//       queryParams.push(req.user.userId);
//     }

//     if (search) {
//       whereClause += " AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.company LIKE ?)";
//       const searchTerm = `%${search}%`;
//       queryParams.push(searchTerm, searchTerm, searchTerm);
//     }

//     if (status) {
//       whereClause += " AND i.status = ?";
//       queryParams.push(status);
//     }

//     if (customerId) {
//       whereClause += " AND i.customer_id = ?";
//       queryParams.push(customerId);
//     }

//     if (dueDateFrom) {
//       whereClause += " AND i.due_date >= ?";
//       queryParams.push(dueDateFrom);
//     }

//     if (dueDateTo) {
//       whereClause += " AND i.due_date <= ?";
//       queryParams.push(dueDateTo);
//     }

//     const invoicesSql = `
//       SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email
//       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
//       ${whereClause} ORDER BY i.created_at DESC LIMIT ${limit} OFFSET ${offset}
//     `;

//     const [invoices] = await pool.execute(invoicesSql, sanitizeParams(...queryParams));

//     const countSql = `SELECT COUNT(*) AS total FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id ${whereClause}`;
//     const [countResult] = await pool.execute(countSql, sanitizeParams(...queryParams));

//     const total = countResult[0]?.total || 0;
//     const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

//     res.json({
//       invoices,
//       pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
//     });
//   } catch (error) {
//     console.error("Invoices fetch error:", error);
//     res.status(500).json({ error: "Failed to fetch invoices" });
//   }
// });

// // Generate invoice PDF
// router.post("/:id/download", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { logoBase64 } = req.body;

//     const [invoices] = await pool.execute(
//       `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
//        c.company AS customer_company, c.address AS customer_address, c.city AS customer_city,
//        c.state AS customer_state, c.zip_code AS customer_zip_code, c.country AS customer_country
//        FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
//       sanitizeParams(id)
//     );

//     if (invoices.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" });
//     }

//     const [items] = await pool.execute(
//       "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//       sanitizeParams(id)
//     );

//     const invoice = invoices[0];
//     const subtotal = Number(invoice.amount || 0);
//     const gstRate = Number(invoice.tax || 18);
//     const gstAmount = (subtotal * gstRate) / 100;
//     const totalWithGst = Number(invoice.total || (subtotal + gstAmount));

//     const formatDate = (value) => {
//       if (!value) {
//         const now = new Date();
//         return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
//       }
//       const d = new Date(value);
//       if (Number.isNaN(d.getTime())) {
//         const now = new Date();
//         return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
//       }
//       return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
//     };

//     const formatCurrency = (amount) => {
//       return `Rs. ${Number(amount).toFixed(2)}`;
//     };

//     const doc = new PDFDocument({ 
//       size: 'A4', 
//       margin: 40,
//       bufferPages: true 
//     });
    
//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
//     doc.pipe(res);

//     const brandPrimary = '#1E3A8A';
//     const brandSecondary = '#3B82F6';
//     const accentGold = '#F59E0B';
//     const textDark = '#1F2937';
//     const textGray = '#6B7280';
//     const bgLight = '#F9FAFB';
//     const borderGray = '#E5E7EB';

//     const pageWidth = 595.28;
//     const pageHeight = 841.89;
//     const marginLeft = 40;
//     const marginRight = 40;
//     const contentWidth = pageWidth - marginLeft - marginRight;

//     let currentY = 40;

//     // ============ LOGO AND INVOICE INFO HEADER ============
//     const headerY = 40;

//     // Logo on the left
//     if (logoBase64) {
//       try {
//         let imageData = logoBase64;
//         if (logoBase64.includes(',')) {
//           imageData = logoBase64.split(',')[1];
//         }
        
//         const logoBuffer = Buffer.from(imageData, 'base64');
        
//         doc.image(logoBuffer, marginLeft, headerY, { 
//           width: 120,
//           height: 45,
//           fit: [120, 45],
//           align: 'left'
//         });
//       } catch (logoError) {
//         console.error("Error adding logo:", logoError);
//       }
//     }

//     // Invoice Number & Date on top-right
//     const rightHeaderX = pageWidth - marginRight - 200;
//     const headerLabelWidth = 80;
//     const headerValueWidth = 120;

//     doc.fontSize(10)
//        .font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text('Invoice No:', rightHeaderX, headerY + 5, { width: headerLabelWidth, align: 'left' });

//     doc.fontSize(10)
//        .font('Helvetica')
//        .fillColor(brandPrimary)
//        .text(invoice.invoice_number || 'N/A', rightHeaderX + headerLabelWidth, headerY + 5, { width: headerValueWidth, align: 'left' });

//     doc.fontSize(10)
//        .font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text('Date:', rightHeaderX, headerY + 22, { width: headerLabelWidth, align: 'left' });

//     doc.fontSize(10)
//        .font('Helvetica')
//        .fillColor(textGray)
//        .text(formatDate(invoice.issue_date || invoice.created_at), rightHeaderX + headerLabelWidth, headerY + 22, { width: headerValueWidth, align: 'left' });

//     currentY = headerY + 65;

//     // ============ COMPANY ADDRESS ============
//     const companyAddress = 'Dani Sanjay Apartment, 102, near Datta Mandir Road, beside Dutta mandir, Kandivali, Veena Sitar, Dahanukar Wadi, Kandivali West, Mumbai, Maharashtra 400067';
    
//     doc.fontSize(8)
//        .font('Helvetica')
//        .fillColor(textGray)
//        .text(companyAddress, marginLeft, currentY, { 
//          width: 350,
//          lineGap: 2,
//          align: 'left'
//        });
    
//     const addressHeight = doc.heightOfString(companyAddress, { width: 350, lineGap: 2 });
//     currentY += addressHeight + 20;

//     // ============ INVOICE TITLE ============
//     doc.fontSize(26)
//        .font('Helvetica-Bold')
//        .fillColor(brandPrimary)
//        .text('INVOICE', marginLeft, currentY, { 
//          align: 'center', 
//          width: contentWidth 
//        });
    
//     currentY += 32;
    
//     doc.moveTo(marginLeft, currentY)
//        .lineTo(pageWidth - marginRight, currentY)
//        .strokeColor(brandSecondary)
//        .lineWidth(2.5)
//        .stroke();
    
//     currentY += 20;

//     // ============ BILL TO & DETAILS ============
//     const leftColX = marginLeft;
//     const leftColWidth = 260;
//     const rightColX = marginLeft + leftColWidth + 20;
//     const startY = currentY;
    
//     doc.fontSize(9)
//        .font('Helvetica-Bold')
//        .fillColor(brandPrimary)
//        .text('BILL TO:', leftColX, startY);
    
//     let leftY = startY + 16;
    
//     doc.fontSize(12)
//        .font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text(invoice.customer_name || 'Customer Name', leftColX, leftY, { width: leftColWidth });
//     leftY += 16;
    
//     if (invoice.customer_company) {
//       doc.fontSize(10).font('Helvetica').fillColor(textGray)
//          .text(invoice.customer_company, leftColX, leftY, { width: leftColWidth });
//       leftY += 14;
//     }
    
//     if (invoice.customer_email) {
//       doc.fontSize(8.5).text(`Email: ${invoice.customer_email}`, leftColX, leftY, { width: leftColWidth });
//       leftY += 12;
//     }
    
//     if (invoice.customer_phone) {
//       doc.fontSize(8.5).text(`Phone: ${invoice.customer_phone}`, leftColX, leftY, { width: leftColWidth });
//       leftY += 12;
//     }
    
//     const addressParts = [invoice.customer_address, invoice.customer_city, invoice.customer_state, invoice.customer_zip_code, invoice.customer_country].filter(Boolean);
//     if (addressParts.length > 0) {
//       const fullAddress = addressParts.join(', ');
//       doc.fontSize(8.5).fillColor(textGray)
//          .text(fullAddress, leftColX, leftY, { width: leftColWidth, lineGap: 2 });
//       const addrH = doc.heightOfString(fullAddress, { width: leftColWidth, lineGap: 2 });
//       leftY += addrH + 6;
//     }
    
//     // Right column: Due Date & Status only
//     let rightY = startY;
//     doc.fontSize(9).font('Helvetica-Bold').fillColor(textDark)
//        .text('Due Date:', rightColX, rightY);
//     rightY += 12;
//     doc.fontSize(9).font('Helvetica').fillColor(textGray)
//        .text(formatDate(invoice.due_date), rightColX, rightY);
//     rightY += 18;
    
//     const statusColors = { paid: '#10B981', pending: '#F59E0B', overdue: '#EF4444', draft: '#6B7280', sent: '#3B82F6' };
//     const statusColor = statusColors[invoice.status] || textGray;
    
//     doc.fontSize(9).font('Helvetica-Bold').fillColor(textDark)
//        .text('Status:', rightColX, rightY);
//     rightY += 12;
//     doc.fontSize(9).font('Helvetica-Bold').fillColor(statusColor)
//        .text((invoice.status || 'DRAFT').toUpperCase(), rightColX, rightY);
    
//     currentY = Math.max(leftY, rightY) + 20;

//     // ============ ITEMS TABLE ============
//     const tableTop = currentY;
//     const tableLeft = marginLeft;
//     const tableWidth = contentWidth;
    
//     const colSrWidth = 35;
//     const colAmountWidth = 110;
//     const colDescWidth = tableWidth - colSrWidth - colAmountWidth;
    
//     const colSrX = tableLeft;
//     const colDescX = tableLeft + colSrWidth;
//     const colAmountX = tableLeft + colSrWidth + colDescWidth;
    
//     doc.rect(tableLeft, tableTop, tableWidth, 30).fillAndStroke(bgLight, borderGray);
    
//     doc.fontSize(9).font('Helvetica-Bold').fillColor(brandPrimary);
//     doc.text('Sr.', colSrX + 4, tableTop + 10, { width: colSrWidth - 8, align: 'center' });
//     doc.text('Service / Description', colDescX + 8, tableTop + 10, { width: colDescWidth - 16, align: 'left' });
//     doc.text('Amount (Rs.)', colAmountX + 10, tableTop + 10, { width: colAmountWidth - 20, align: 'right' });
    
//     let rowY = tableTop + 30;
//     doc.fontSize(9).font('Helvetica').fillColor(textDark);
    
//     if (items && items.length > 0) {
//       items.forEach((item, idx) => {
//         const rowHeight = 30;
//         if (idx % 2 === 1) doc.rect(tableLeft, rowY, tableWidth, rowHeight).fill('#FAFAFA');
        
//         doc.fillColor(textDark);
//         doc.text((idx + 1).toString(), colSrX + 4, rowY + 10, { width: colSrWidth - 8, align: 'center' });
//         doc.text(item.description || 'Service', colDescX + 8, rowY + 10, { width: colDescWidth - 16 });
//         doc.font('Helvetica-Bold').text(Number(item.amount || 0).toFixed(2), colAmountX + 10, rowY + 10, { width: colAmountWidth - 20, align: 'right' });
//         doc.font('Helvetica');
//         rowY += rowHeight;
//       });
//     } else {
//       doc.text('1', colSrX + 4, rowY + 10, { width: colSrWidth - 8, align: 'center' });
//       doc.text('Service Charges', colDescX + 8, rowY + 10, { width: colDescWidth - 16 });
//       doc.font('Helvetica-Bold').text(subtotal.toFixed(2), colAmountX + 10, rowY + 10, { width: colAmountWidth - 20, align: 'right' });
//       doc.font('Helvetica');
//       rowY += 30;
//     }
    
//     doc.moveTo(tableLeft, rowY).lineTo(tableLeft + tableWidth, rowY).strokeColor(borderGray).lineWidth(1).stroke();
//     rowY += 20;

//     // ============ TOTALS SECTION ============
//     const totalsStartX = pageWidth - marginRight - 240;
//     const labelX = totalsStartX;
//     const valueX = pageWidth - marginRight - 90;
//     const totalsValueWidth = 80; // Renamed to avoid conflict

//     doc.fontSize(10).font('Helvetica').fillColor(textDark)
//        .text('Subtotal:', labelX, rowY, { width: 145, align: 'left' });
//     doc.font('Helvetica-Bold').text(formatCurrency(subtotal), valueX, rowY, { width: totalsValueWidth, align: 'right' });
//     rowY += 16;
    
//     doc.font('Helvetica').fillColor(accentGold)
//        .text(`GST (${gstRate}%):`, labelX, rowY, { width: 145, align: 'left' });
//     doc.font('Helvetica-Bold').fillColor(accentGold)
//        .text(formatCurrency(gstAmount), valueX, rowY, { width: totalsValueWidth, align: 'right' });
//     rowY += 16;
    
//     doc.moveTo(labelX, rowY).lineTo(pageWidth - marginRight, rowY).strokeColor(borderGray).lineWidth(1).stroke();
//     rowY += 10;
    
//     const boxHeight = 35;
//     const boxWidth = 245;
//     doc.rect(labelX - 5, rowY - 5, boxWidth, boxHeight).fillAndStroke('#EEF2FF', brandSecondary);
    
//     doc.fontSize(11).font('Helvetica-Bold').fillColor(brandPrimary)
//        .text('Total Payable:', labelX, rowY + 10, { width: 140, align: 'left' });
    
//     doc.fontSize(13).font('Helvetica-Bold').fillColor(brandPrimary)
//        .text(formatCurrency(totalWithGst), valueX - 5, rowY + 9, { width: totalsValueWidth + 5, align: 'right' });
    
//     rowY += boxHeight + 15;
    
//     // ============ NOTES ============
//     if (invoice.notes && invoice.notes.trim()) {
//       if (rowY < pageHeight - 150) {
//         doc.fontSize(10).font('Helvetica-Bold').fillColor(textDark)
//            .text('Notes:', marginLeft, rowY);
//         rowY += 14;
//         doc.fontSize(9).font('Helvetica').fillColor(textGray)
//            .text(invoice.notes.trim(), marginLeft, rowY, { width: contentWidth, lineGap: 2 });
//       }
//     }
    
//     // ============ FOOTER ============
//     const footerY = pageHeight - 60;
//     doc.fontSize(9).font('Helvetica').fillColor(textGray)
//        .text('Thank you for your business!', marginLeft, footerY, { align: 'center', width: contentWidth });
    
//     doc.fontSize(7.5).fillColor('#9CA3AF')
//        .text(`Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}`, 
//              marginLeft, footerY + 14, { align: 'center', width: contentWidth });

//     doc.end();
//   } catch (error) {
//     console.error("Invoice PDF generation error:", error);
//     if (!res.headersSent) {
//       res.status(500).json({ error: "Failed to generate invoice PDF", details: error.message });
//     }
//   }
// });

// router.post("/", authenticateToken, [
//   body("customerId").notEmpty().withMessage("Customer ID is required"),
//   body("items").isArray({ min: 1 }).withMessage("Items array required"),
// ], async (req, res) => {
//   try {
//     if (handleValidation(req, res)) return;

//     const { customerId, items } = req.body;
    
//     const [customers] = await pool.execute(
//       `SELECT id, assigned_to, default_tax_rate, default_due_days, default_invoice_notes FROM customers WHERE id = ?`,
//       sanitizeParams(customerId)
//     );

//     if (customers.length === 0) {
//       return res.status(400).json({ error: "Customer not found" });
//     }

//     const customer = customers[0];

//     if (req.user.role !== "admin" && customer.assigned_to !== req.user.userId) {
//       return res.status(403).json({ error: "You do not have permission to invoice this customer" });
//     }

//     const built = buildInvoiceFromCustomer(customer, req.body);
//     const invoiceNumber = generateInvoiceNumber();
//     const invoiceId = uuidv4();

//     const connection = await pool.getConnection();
//     await connection.beginTransaction();

//     try {
//       try {
//         await connection.execute(
//           `INSERT INTO invoices (id, customer_id, invoice_number, amount, tax, total, status, issue_date, due_date, notes)
//            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(
//             invoiceId, customerId, invoiceNumber, built.amount, built.tax, built.total, built.status, built.issueDate, built.dueDate, built.notes
//           )
//         );
//       } catch (insertError) {
//         console.error("Error with issue_date, trying without:", insertError);
//         await connection.execute(
//           `INSERT INTO invoices (id, customer_id, invoice_number, amount, tax, total, status, due_date, notes)
//            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(invoiceId, customerId, invoiceNumber, built.amount, built.tax, built.total, built.status, built.dueDate, built.notes)
//         );
//       }

//       for (const item of items) {
//         await connection.execute(
//           `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(uuidv4(), invoiceId, item.description, item.quantity, item.rate, item.amount)
//         );
//       }

//       await connection.commit();

//       const [createdInvoices] = await connection.execute(
//         `SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email
//          FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
//         sanitizeParams(invoiceId)
//       );

//       const [invoiceItems] = await connection.execute(
//         "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//         sanitizeParams(invoiceId)
//       );

//       const invoice = createdInvoices[0];
//       invoice.items = invoiceItems;

//       res.status(201).json({ message: "Invoice created successfully", invoice });
//     } catch (err) {
//       await connection.rollback();
//       throw err;
//     } finally {
//       connection.release();
//     }
//   } catch (error) {
//     console.error("Invoice creation error:", error);
//     res.status(500).json({ error: "Failed to create invoice", details: error.message });
//   }
// });

// router.put("/:id", authenticateToken, async (req, res) => {
//   try {
//     if (handleValidation(req, res)) return;

//     const { id } = req.params;
//     const updateData = { ...req.body };

//     const access = await ensureCanAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [existingInvoices] = await pool.execute("SELECT id, status, customer_id FROM invoices WHERE id = ?", sanitizeParams(id));
//     if (existingInvoices.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" });
//     }

//     if (updateData.dueDate) updateData.dueDate = toSqlDate(updateData.dueDate);
//     if (updateData.paidDate) updateData.paidDate = toSqlDate(updateData.paidDate);

//     const connection = await pool.getConnection();
//     await connection.beginTransaction();

//     try {
//       const updateFields = [];
//       const updateValues = [];

//       Object.entries(updateData).forEach(([key, value]) => {
//         if (key === "items" || value === undefined) return;
//         const dbField = invoiceFieldMap[key];
//         if (!dbField) return;
//         updateFields.push(`${dbField} = ?`);
//         updateValues.push(value);
//       });

//       if (updateFields.length > 0) {
//         updateValues.push(id);
//         await connection.execute(
//           `UPDATE invoices SET ${updateFields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
//           sanitizeParams(...updateValues)
//         );
//       }

//       if (Array.isArray(updateData.items)) {
//         await connection.execute("DELETE FROM invoice_items WHERE invoice_id = ?", sanitizeParams(id));
//         for (const item of updateData.items) {
//           await connection.execute(
//             `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)`,
//             sanitizeParams(uuidv4(), id, item.description, item.quantity, item.rate, item.amount)
//           );
//         }
//       }

//       await connection.commit();

//       const [invoices] = await connection.execute(
//         `SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email
//          FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
//         sanitizeParams(id)
//       );

//       const [invoiceItems] = await connection.execute(
//         "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//         sanitizeParams(id)
//       );

//       const invoice = invoices[0];
//       invoice.items = invoiceItems;

//       res.json({ message: "Invoice updated successfully", invoice });
//     } catch (err) {
//       await connection.rollback();
//       throw err;
//     } finally {
//       connection.release();
//     }
//   } catch (error) {
//     console.error("Invoice update error:", error);
//     res.status(500).json({ error: "Failed to update invoice" });
//   }
// });

// router.delete("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const access = await ensureCanAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [existing] = await pool.execute("SELECT id FROM invoices WHERE id = ?", sanitizeParams(id));
//     if (existing.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" });
//     }

//     await pool.execute("DELETE FROM invoices WHERE id = ?", sanitizeParams(id));
//     res.json({ message: "Invoice deleted successfully" });
//   } catch (error) {
//     console.error("Invoice deletion error:", error);
//     res.status(500).json({ error: "Failed to delete invoice" });
//   }
// });

// router.get("/stats/overview", authenticateToken, async (req, res) => {
//   try {
//     let whereClause = "WHERE 1=1";
//     const params = [];

//     if (req.user.role !== "admin") {
//       whereClause += " AND c.assigned_to = ?";
//       params.push(req.user.userId);
//     }

//     const [stats] = await pool.execute(
//       `SELECT i.status, COUNT(*) AS count, SUM(i.total) AS total_amount FROM invoices i
//        LEFT JOIN customers c ON i.customer_id = c.id ${whereClause} GROUP BY i.status`,
//       sanitizeParams(...params)
//     );

//     const [monthlyStats] = await pool.execute(
//       `SELECT DATE_FORMAT(i.created_at, '%Y-%m') AS month, COUNT(*) AS count, SUM(i.total) AS total_amount
//        FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
//        ${whereClause} AND i.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
//        GROUP BY DATE_FORMAT(i.created_at, '%Y-%m') ORDER BY month`,
//       sanitizeParams(...params)
//     );

//     const [overdueInvoices] = await pool.execute(
//       `SELECT COUNT(*) AS count, SUM(i.total) AS total_amount FROM invoices i
//        LEFT JOIN customers c ON i.customer_id = c.id
//        ${whereClause} AND i.status IN ('sent', 'overdue') AND i.due_date < CURDATE()`,
//       sanitizeParams(...params)
//     );

//     res.json({
//       statusBreakdown: stats,
//       monthlyTrend: monthlyStats,
//       overdue: overdueInvoices[0],
//     });
//   } catch (error) {
//     console.error("Invoice stats error:", error);
//     res.status(500).json({ error: "Failed to fetch invoice statistics" });
//   }
// });

// module.exports = router;



//testing for just pdf responsive 26-12-2025

const { v4: uuidv4 } = require("uuid");
const PDFDocument = require("pdfkit");
const express = require("express");
const { body, validationResult } = require("express-validator");
const { pool } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { generateInvoiceNumber } = require("../utils/helpers");

const router = express.Router();

const sanitizeParams = (...params) => {
  return params.map((param) => (param === undefined ? null : param));
};

const toSqlDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: "Validation failed", details: errors.array() });
    return true;
  }
  return false;
};

const invoiceFieldMap = {
  customerId: "customer_id",
  amount: "amount",
  tax: "tax",
  total: "total",
  status: "status",
  issueDate: "issue_date",
  dueDate: "due_date",
  paidDate: "paid_date",
  notes: "notes",
};

const buildInvoiceFromCustomer = (customer, body) => {
  const { amount, tax, total, status, issueDate, dueDate, notes, items } = body;

  let derivedAmount = amount;
  if (derivedAmount === undefined && Array.isArray(items)) {
    derivedAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }

  const defaultTaxRate = customer.default_tax_rate ?? 0;
  const finalAmount = Number(derivedAmount || 0);
  const finalTax = tax !== undefined ? Number(tax) : defaultTaxRate || 0;
  const finalTotal = total !== undefined ? Number(total) : finalAmount + (finalAmount * finalTax) / 100;

  let finalIssueDate = issueDate ? toSqlDate(issueDate) : toSqlDate(new Date());

  let finalDueDate;
  if (dueDate) {
    finalDueDate = toSqlDate(dueDate);
  } else {
    const dueDays = customer.default_due_days ?? 7;
    const d = new Date();
    d.setDate(d.getDate() + Number(dueDays));
    finalDueDate = toSqlDate(d);
  }

  const finalStatus = status || "draft";
  const finalNotes = notes ?? customer.default_invoice_notes ?? null;

  return {
    amount: finalAmount,
    tax: finalTax,
    total: finalTotal,
    status: finalStatus,
    issueDate: finalIssueDate,
    dueDate: finalDueDate,
    notes: finalNotes,
  };
};

const ensureCanAccessInvoice = async (req, res, invoiceId) => {
  if (req.user.role === "admin") return { ok: true };

  const [rows] = await pool.execute(
    `SELECT i.id FROM invoices i INNER JOIN customers c ON i.customer_id = c.id WHERE i.id = ? AND c.assigned_to = ?`,
    sanitizeParams(invoiceId, req.user.userId)
  );

  if (rows.length === 0) {
    return {
      ok: false,
      response: res.status(403).json({ error: "You do not have permission to access this invoice" }),
    };
  }
  return { ok: true };
};

// Get all invoices (unchanged)
 router.get("/", authenticateToken, async (req, res) => {
  try {
    if (handleValidation(req, res)) return;

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const { search, status, customerId, dueDateFrom, dueDateTo } = req.query;

    let whereClause = "WHERE 1=1";
    const queryParams = [];

    if (req.user.role !== "admin") {
      whereClause += " AND c.assigned_to = ?";
      queryParams.push(req.user.userId);
    }

    if (search) {
      whereClause += " AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.company LIKE ?)";
      const searchTerm = `%${search}%`;
      queryParams.push(searchTerm, searchTerm, searchTerm);
    }

    if (status) {
      whereClause += " AND i.status = ?";
      queryParams.push(status);
    }

    if (customerId) {
      whereClause += " AND i.customer_id = ?";
      queryParams.push(customerId);
    }

    if (dueDateFrom) {
      whereClause += " AND i.due_date >= ?";
      queryParams.push(dueDateFrom);
    }

    if (dueDateTo) {
      whereClause += " AND i.due_date <= ?";
      queryParams.push(dueDateTo);
    }

    const invoicesSql = `
      SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email
      FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
      ${whereClause} ORDER BY i.created_at DESC LIMIT ${limit} OFFSET ${offset}
    `;

    const [invoices] = await pool.execute(invoicesSql, sanitizeParams(...queryParams));

    const countSql = `SELECT COUNT(*) AS total FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id ${whereClause}`;
    const [countResult] = await pool.execute(countSql, sanitizeParams(...queryParams));

    const total = countResult[0]?.total || 0;
    const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

    res.json({
      invoices,
      pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    });
  } catch (error) {
    console.error("Invoices fetch error:", error);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

// Generate invoice PDF - OPTIMIZED & RESPONSIVE
router.post("/:id/download", async (req, res) => {
  try {
    const { id } = req.params;
    const { logoBase64 } = req.body;

    const [invoices] = await pool.execute(
      `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
       c.company AS customer_company, c.address AS customer_address, c.city AS customer_city,
       c.state AS customer_state, c.zip_code AS customer_zip_code, c.country AS customer_country
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
      sanitizeParams(id)
    );

    if (invoices.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const [items] = await pool.execute(
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
      sanitizeParams(id)
    );

    const invoice = invoices[0];
    const subtotal = Number(invoice.amount || 0);
    const gstRate = Number(invoice.tax || 18);
    const gstAmount = (subtotal * gstRate) / 100;
    const totalWithGst = Number(invoice.total || (subtotal + gstAmount));

    const formatDate = (value) => {
      if (!value) {
        const now = new Date();
        return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
      }
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return formatDate();
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    };

    const formatCurrency = (amount) => `Rs. ${Number(amount).toFixed(2)}`;

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
    doc.pipe(res);

    const brandPrimary = '#1E3A8A';
    const brandSecondary = '#3B82F6';
    const accentGold = '#F59E0B';
    const textDark = '#1F2937';
    const textGray = '#6B7280';
    const bgLight = '#F9FAFB';
    const borderGray = '#E5E7EB';

    const pageWidth = 595.28;
    const marginLeft = 40;
    const marginRight = 40;
    const contentWidth = pageWidth - marginLeft - marginRight;

    let y = 40; // Starting Y position

    // ============ HEADER: LOGO + INVOICE NO & DATE ============
    if (logoBase64) {
      try {
        let imageData = logoBase64.includes(',') ? logoBase64.split(',')[1] : logoBase64;
        const logoBuffer = Buffer.from(imageData, 'base64');
        doc.image(logoBuffer, marginLeft, y, { width: 130, fit: [130, 50] });
      } catch (err) {
        console.error("Logo error:", err);
      }
    }

    // Top-right: Invoice No & Date
    const rightX = pageWidth - marginRight - 180;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(textDark)
       .text('Invoice No:', rightX, y + 8);
    doc.fontSize(10).font('Helvetica').fillColor(brandPrimary)
       .text(invoice.invoice_number || 'N/A', rightX + 70, y + 8);

    doc.fontSize(10).font('Helvetica-Bold').fillColor(textDark)
       .text('Date:', rightX, y + 25);
    doc.fontSize(10).font('Helvetica').fillColor(textGray)
       .text(formatDate(invoice.issue_date || invoice.created_at), rightX + 70, y + 25);

    y += 60; // Move down after header

    // ============ COMPANY ADDRESS ============
    const companyAddress = 'Dani Sanjay Apartment, 102, near Datta Mandir Road, beside Dutta mandir, Kandivali, Veena Sitar, Dahanukar Wadi, Kandivali West, Mumbai, Maharashtra 400067';
    doc.fontSize(8).font('Helvetica').fillColor(textGray)
       .text(companyAddress, marginLeft, y, { width: 300, lineGap: 1.5 });
    y += doc.heightOfString(companyAddress, { width: 300 }) + 12;

    // ============ INVOICE TITLE ============
    doc.fontSize(28).font('Helvetica-Bold').fillColor(brandPrimary)
       .text('INVOICE', marginLeft, y, { align: 'center', width: contentWidth });
    y += 35;

    doc.moveTo(marginLeft, y).lineTo(pageWidth - marginRight, y)
       .strokeColor(brandSecondary).lineWidth(2).stroke();
    y += 15;

    // ============ BILL TO & DUE DATE/STATUS ============
    const billToX = marginLeft;
    const detailsX = marginLeft + 280;

    doc.fontSize(9).font('Helvetica-Bold').fillColor(brandPrimary)
       .text('BILL TO:', billToX, y);

    let billY = y + 15;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(textDark)
       .text(invoice.customer_name || 'Customer Name', billToX, billY);
    billY += 18;

    if (invoice.customer_company) {
      doc.fontSize(10).font('Helvetica').fillColor(textGray)
         .text(invoice.customer_company, billToX, billY);
      billY += 14;
    }
    if (invoice.customer_email) {
      doc.fontSize(9).text(`Email: ${invoice.customer_email}`, billToX, billY);
      billY += 12;
    }
    if (invoice.customer_phone) {
      doc.fontSize(9).text(`Phone: ${invoice.customer_phone}`, billToX, billY);
      billY += 12;
    }

    const addrParts = [invoice.customer_address, invoice.customer_city, invoice.customer_state, invoice.customer_zip_code, invoice.customer_country].filter(Boolean);
    if (addrParts.length > 0) {
      const addr = addrParts.join(', ');
      doc.fontSize(9).fillColor(textGray)
         .text(addr, billToX, billY, { width: 260, lineGap: 1.5 });
      billY += doc.heightOfString(addr, { width: 260 }) + 8;
    }

    // Right side: Due Date & Status
    let detailsY = y + 15;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(textDark)
       .text('Due Date:', detailsX, detailsY);
    doc.fontSize(9).font('Helvetica').fillColor(textGray)
       .text(formatDate(invoice.due_date), detailsX + 60, detailsY);
    detailsY += 18;

    const statusColors = { paid: '#10B981', pending: '#F59E0B', overdue: '#EF4444', draft: '#6B7280', sent: '#3B82F6' };
    const statusColor = statusColors[invoice.status] || textGray;

    doc.fontSize(9).font('Helvetica-Bold').fillColor(textDark)
       .text('Status:', detailsX, detailsY);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(statusColor)
       .text((invoice.status || 'DRAFT').toUpperCase(), detailsX + 60, detailsY);

    y = Math.max(billY, detailsY + 20);

    // ============ ITEMS TABLE ============
    const tableTop = y;
    const colWidths = { sr: 40, desc: contentWidth - 150, amount: 110 };
    const colX = {
      sr: marginLeft,
      desc: marginLeft + colWidths.sr,
      amount: pageWidth - marginRight - colWidths.amount
    };

    // Header
    doc.rect(marginLeft, tableTop, contentWidth, 28).fillAndStroke(bgLight, borderGray);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(brandPrimary);
    doc.text('Sr.', colX.sr + 5, tableTop + 10, { width: colWidths.sr, align: 'center' });
    doc.text('Service / Description', colX.desc + 8, tableTop + 10, { width: colWidths.desc - 16 });
    doc.text('Amount (Rs.)', colX.amount, tableTop + 10, { width: colWidths.amount, align: 'right' });

    y = tableTop + 28;
    doc.fontSize(9).font('Helvetica').fillColor(textDark);

    const rowHeight = 28;
    const rows = items.length > 0 ? items : [{ description: 'Service Charges', amount: subtotal }];

    rows.forEach((item, i) => {
      if (i % 2 === 1) doc.rect(marginLeft, y, contentWidth, rowHeight).fill('#FAFAFA');

      doc.text((i + 1).toString(), colX.sr + 5, y + 10, { width: colWidths.sr, align: 'center' });
      doc.text(item.description || 'Service', colX.desc + 8, y + 10, { width: colWidths.desc - 16 });
      doc.font('Helvetica-Bold').text(Number(item.amount || 0).toFixed(2), colX.amount, y + 10, { width: colWidths.amount, align: 'right' });
      doc.font('Helvetica');

      y += rowHeight;
    });

    doc.moveTo(marginLeft, y).lineTo(pageWidth - marginRight, y).strokeColor(borderGray).lineWidth(1).stroke();
    y += 15;

    // ============ TOTALS ============
    const totalsX = pageWidth - marginRight - 220;
    const labelX = totalsX;
    const valueX = pageWidth - marginRight - 80;

    doc.fontSize(10).font('Helvetica').fillColor(textDark)
       .text('Subtotal:', labelX, y);
    doc.font('Helvetica-Bold').text(formatCurrency(subtotal), valueX, y, { align: 'right', width: 80 });
    y += 15;

    doc.font('Helvetica').fillColor(accentGold)
       .text(`GST (${gstRate}%):`, labelX, y);
    doc.font('Helvetica-Bold').fillColor(accentGold)
       .text(formatCurrency(gstAmount), valueX, y, { align: 'right', width: 80 });
    y += 15;

    doc.moveTo(labelX, y).lineTo(pageWidth - marginRight, y).strokeColor(borderGray).lineWidth(1).stroke();
    y += 10;

    // Total Box
    doc.rect(labelX - 8, y - 5, 228, 32).fillAndStroke('#EEF2FF', brandSecondary);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(brandPrimary)
       .text('Total Payable:', labelX, y + 8);
    doc.fontSize(13).font('Helvetica-Bold').fillColor(brandPrimary)
       .text(formatCurrency(totalWithGst), valueX - 5, y + 7, { align: 'right', width: 85 });

    y += 45;

    // ============ NOTES ============
    if (invoice.notes && invoice.notes.trim()) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor(textDark)
         .text('Notes:', marginLeft, y);
      y += 14;
      doc.fontSize(9).font('Helvetica').fillColor(textGray)
         .text(invoice.notes.trim(), marginLeft, y, { width: contentWidth, lineGap: 2 });
      y += doc.heightOfString(invoice.notes.trim(), { width: contentWidth }) + 20;
    }

    // ============ FOOTER ============
    const footerY = 780;
    doc.fontSize(9).font('Helvetica').fillColor(textGray)
       .text('Thank you for your business!', marginLeft, footerY, { align: 'center', width: contentWidth });

    doc.fontSize(7.5).fillColor('#9CA3AF')
       .text(`Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
             marginLeft, footerY + 12, { align: 'center', width: contentWidth });

    doc.end();
  } catch (error) {
    console.error("Invoice PDF generation error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate invoice PDF" });
    }
  }
});
router.post("/", authenticateToken, [
  body("customerId").notEmpty().withMessage("Customer ID is required"),
  body("items").isArray({ min: 1 }).withMessage("Items array required"),
], async (req, res) => {
  try {
    if (handleValidation(req, res)) return;

    const { customerId, items } = req.body;
    
    const [customers] = await pool.execute(
      `SELECT id, assigned_to, default_tax_rate, default_due_days, default_invoice_notes FROM customers WHERE id = ?`,
      sanitizeParams(customerId)
    );

    if (customers.length === 0) {
      return res.status(400).json({ error: "Customer not found" });
    }

    const customer = customers[0];

    if (req.user.role !== "admin" && customer.assigned_to !== req.user.userId) {
      return res.status(403).json({ error: "You do not have permission to invoice this customer" });
    }

    const built = buildInvoiceFromCustomer(customer, req.body);
    const invoiceNumber = generateInvoiceNumber();
    const invoiceId = uuidv4();

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      try {
        await connection.execute(
          `INSERT INTO invoices (id, customer_id, invoice_number, amount, tax, total, status, issue_date, due_date, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          sanitizeParams(
            invoiceId, customerId, invoiceNumber, built.amount, built.tax, built.total, built.status, built.issueDate, built.dueDate, built.notes
          )
        );
      } catch (insertError) {
        console.error("Error with issue_date, trying without:", insertError);
        await connection.execute(
          `INSERT INTO invoices (id, customer_id, invoice_number, amount, tax, total, status, due_date, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          sanitizeParams(invoiceId, customerId, invoiceNumber, built.amount, built.tax, built.total, built.status, built.dueDate, built.notes)
        );
      }

      for (const item of items) {
        await connection.execute(
          `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)`,
          sanitizeParams(uuidv4(), invoiceId, item.description, item.quantity, item.rate, item.amount)
        );
      }

      await connection.commit();

      const [createdInvoices] = await connection.execute(
        `SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email
         FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
        sanitizeParams(invoiceId)
      );

      const [invoiceItems] = await connection.execute(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
        sanitizeParams(invoiceId)
      );

      const invoice = createdInvoices[0];
      invoice.items = invoiceItems;

      res.status(201).json({ message: "Invoice created successfully", invoice });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Invoice creation error:", error);
    res.status(500).json({ error: "Failed to create invoice", details: error.message });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  try {
    if (handleValidation(req, res)) return;

    const { id } = req.params;
    const updateData = { ...req.body };

    const access = await ensureCanAccessInvoice(req, res, id);
    if (!access.ok) return;

    const [existingInvoices] = await pool.execute("SELECT id, status, customer_id FROM invoices WHERE id = ?", sanitizeParams(id));
    if (existingInvoices.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (updateData.dueDate) updateData.dueDate = toSqlDate(updateData.dueDate);
    if (updateData.paidDate) updateData.paidDate = toSqlDate(updateData.paidDate);

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const updateFields = [];
      const updateValues = [];

      Object.entries(updateData).forEach(([key, value]) => {
        if (key === "items" || value === undefined) return;
        const dbField = invoiceFieldMap[key];
        if (!dbField) return;
        updateFields.push(`${dbField} = ?`);
        updateValues.push(value);
      });

      if (updateFields.length > 0) {
        updateValues.push(id);
        await connection.execute(
          `UPDATE invoices SET ${updateFields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          sanitizeParams(...updateValues)
        );
      }

      if (Array.isArray(updateData.items)) {
        await connection.execute("DELETE FROM invoice_items WHERE invoice_id = ?", sanitizeParams(id));
        for (const item of updateData.items) {
          await connection.execute(
            `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)`,
            sanitizeParams(uuidv4(), id, item.description, item.quantity, item.rate, item.amount)
          );
        }
      }

      await connection.commit();

      const [invoices] = await connection.execute(
        `SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email
         FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
        sanitizeParams(id)
      );

      const [invoiceItems] = await connection.execute(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
        sanitizeParams(id)
      );

      const invoice = invoices[0];
      invoice.items = invoiceItems;

      res.json({ message: "Invoice updated successfully", invoice });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Invoice update error:", error);
    res.status(500).json({ error: "Failed to update invoice" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await ensureCanAccessInvoice(req, res, id);
    if (!access.ok) return;

    const [existing] = await pool.execute("SELECT id FROM invoices WHERE id = ?", sanitizeParams(id));
    if (existing.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    await pool.execute("DELETE FROM invoices WHERE id = ?", sanitizeParams(id));
    res.json({ message: "Invoice deleted successfully" });
  } catch (error) {
    console.error("Invoice deletion error:", error);
    res.status(500).json({ error: "Failed to delete invoice" });
  }
});

router.get("/stats/overview", authenticateToken, async (req, res) => {
  try {
    let whereClause = "WHERE 1=1";
    const params = [];

    if (req.user.role !== "admin") {
      whereClause += " AND c.assigned_to = ?";
      params.push(req.user.userId);
    }

    const [stats] = await pool.execute(
      `SELECT i.status, COUNT(*) AS count, SUM(i.total) AS total_amount FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id ${whereClause} GROUP BY i.status`,
      sanitizeParams(...params)
    );

    const [monthlyStats] = await pool.execute(
      `SELECT DATE_FORMAT(i.created_at, '%Y-%m') AS month, COUNT(*) AS count, SUM(i.total) AS total_amount
       FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id
       ${whereClause} AND i.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY DATE_FORMAT(i.created_at, '%Y-%m') ORDER BY month`,
      sanitizeParams(...params)
    );

    const [overdueInvoices] = await pool.execute(
      `SELECT COUNT(*) AS count, SUM(i.total) AS total_amount FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       ${whereClause} AND i.status IN ('sent', 'overdue') AND i.due_date < CURDATE()`,
      sanitizeParams(...params)
    );

    res.json({
      statusBreakdown: stats,
      monthlyTrend: monthlyStats,
      overdue: overdueInvoices[0],
    });
  } catch (error) {
    console.error("Invoice stats error:", error);
    res.status(500).json({ error: "Failed to fetch invoice statistics" });
  }
});

module.exports = router;