// const { v4: uuidv4 } = require("uuid");

// const express = require("express");
// const { body, validationResult, query } = require("express-validator");
// const { pool } = require("../config/database");
// const { authenticateToken } = require("../middleware/auth");
// const { generateInvoiceNumber } = require("../utils/helpers");

// const router = express.Router();

// // Helper: convert undefined to null for MySQL compatibility
// const sanitizeParams = (...params) => {
//   return params.map((param) => (param === undefined ? null : param));
// };

// // Helper: normalize Date/ISO string to MySQL DATE (YYYY-MM-DD)
// const toSqlDate = (value) => {
//   if (!value) return null;
//   const d = value instanceof Date ? value : new Date(value);
//   if (Number.isNaN(d.getTime())) return null;
//   const y = d.getFullYear();
//   const m = String(d.getMonth() + 1).padStart(2, "0");
//   const day = String(d.getDate()).padStart(2, "0");
//   return `${y}-${m}-${day}`;
// };

// // Helpers
// const handleValidation = (req, res) => {
//   const errors = validationResult(req);
//   if (!errors.isEmpty()) {
//     res.status(400).json({
//       error: "Validation failed",
//       details: errors.array(),
//     });
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
//   dueDate: "due_date",
//   paidDate: "paid_date",
//   notes: "notes",
// };

// // Build invoice values from customer + request body
// // Assumes customers table has optional fields like default_tax_rate, default_due_days, default_invoice_notes, etc.
// const buildInvoiceFromCustomer = (customer, body) => {
//   const { amount, tax, total, status, dueDate, notes, items } = body;

//   // If amount/total not provided, derive from items
//   let derivedAmount = amount;
//   if (derivedAmount === undefined && Array.isArray(items)) {
//     derivedAmount = items.reduce(
//       (sum, item) => sum + Number(item.amount || 0),
//       0
//     );
//   }

//   const defaultTaxRate = customer.default_tax_rate ?? 0;
//   const finalAmount = Number(derivedAmount || 0);

//   // If caller already supplied `tax`, treat as numeric final value
//   const finalTax =
//     tax !== undefined ? Number(tax) : Math.round(finalAmount * (defaultTaxRate / 100));

//   const finalTotal =
//     total !== undefined ? Number(total) : finalAmount + finalTax;

//   // Due date: use body.dueDate if provided, else today + customer.default_due_days (fallback 7)
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
//     dueDate: finalDueDate,
//     notes: finalNotes,
//   };
// };

// // helper: ensure current user can access invoice (via customer.assigned_to)
// const ensureCanAccessInvoice = async (req, res, invoiceId) => {
//   if (req.user.role === "admin") return { ok: true };

//   const [rows] = await pool.execute(
//     `
//     SELECT i.id
//     FROM invoices i
//     INNER JOIN customers c ON i.customer_id = c.id
//     WHERE i.id = ? AND c.assigned_to = ?
//   `,
//     sanitizeParams(invoiceId, req.user.userId)
//   );

//   if (rows.length === 0) {
//     return {
//       ok: false,
//       response: res
//         .status(403)
//         .json({ error: "You do not have permission to access this invoice" }),
//     };
//   }

//   return { ok: true };
// };

// // Get all invoices with filtering and pagination
// router.get(
//   "/",
//   authenticateToken,
//   [
//     query("page")
//       .optional()
//       .isInt({ min: 1 })
//       .withMessage("Page must be a positive integer"),
//     query("limit")
//       .optional()
//       .isInt({ min: 1, max: 100 })
//       .withMessage("Limit must be between 1 and 100"),
//     query("search").optional().isString().withMessage("Search must be a string"),
//     query("status")
//       .optional()
//       .isIn(["draft", "sent", "paid", "overdue", "cancelled"])
//       .withMessage("Invalid status"),
//     query("customerId").optional().isString().withMessage("Customer ID must be a string"),
//     query("dueDateFrom")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date from must be a valid date"),
//     query("dueDateTo")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date to must be a valid date"),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const pageRaw = Number.parseInt(req.query.page, 10);
//       const limitRaw = Number.parseInt(req.query.limit, 10);

//       const page = !Number.isNaN(pageRaw) && pageRaw > 0 ? pageRaw : 1;
//       const limit =
//         !Number.isNaN(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 10;
//       const offset = (page - 1) * limit;

//       if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
//         return res.status(400).json({ error: "Invalid pagination parameters" });
//       }

//       const { search, status, customerId, dueDateFrom, dueDateTo } = req.query;

//       let whereClause = "WHERE 1=1";
//       const queryParams = [];

//       if (req.user.role !== "admin") {
//         whereClause += " AND c.assigned_to = ?";
//         queryParams.push(req.user.userId);
//       }

//       if (search) {
//         whereClause +=
//           " AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.company LIKE ?)";
//         const searchTerm = `%${search}%`;
//         queryParams.push(searchTerm, searchTerm, searchTerm);
//       }

//       if (status) {
//         whereClause += " AND i.status = ?";
//         queryParams.push(status);
//       }

//       if (customerId) {
//         whereClause += " AND i.customer_id = ?";
//         queryParams.push(customerId);
//       }

//       if (dueDateFrom) {
//         whereClause += " AND i.due_date >= ?";
//         queryParams.push(dueDateFrom);
//       }

//       if (dueDateTo) {
//         whereClause += " AND i.due_date <= ?";
//         queryParams.push(dueDateTo);
//       }

//       // FIX: interpolate LIMIT/OFFSET as integers instead of placeholders
//       const invoicesSql = `
//         SELECT 
//           i.*,
//           c.name AS customer_name,
//           c.company AS customer_company,
//           c.email AS customer_email
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//         ORDER BY i.created_at DESC
//         LIMIT ${Number(limit)} OFFSET ${Number(offset)}
//       `;

//       const [invoices] = await pool.execute(invoicesSql, queryParams);

//       const countSql = `
//         SELECT COUNT(*) AS total 
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//       `;
//       const [countResult] = await pool.execute(countSql, queryParams);

//       const total = countResult[0]?.total || 0;
//       const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

//       res.json({
//         invoices,
//         pagination: {
//           page,
//           limit,
//           total,
//           totalPages,
//           hasNext: page < totalPages,
//           hasPrev: page > 1,
//         },
//       });
//     } catch (error) {
//       console.error("Invoices fetch error:", error);
//       res.status(500).json({ error: "Failed to fetch invoices" });
//     }
//   }
// );

// // Get invoice by ID with items
// router.get("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;

//     const access = await ensureCanAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [invoices] = await pool.execute(
//       `
//       SELECT 
//         i.*,
//         c.name AS customer_name,
//         c.company AS customer_company,
//         c.email AS customer_email,
//         c.phone AS customer_phone,
//         c.address AS customer_address,
//         c.city AS customer_city,
//         c.state AS customer_state,
//         c.zip_code AS customer_zip_code,
//         c.country AS customer_country
//       FROM invoices i
//       LEFT JOIN customers c ON i.customer_id = c.id
//       WHERE i.id = ?
//     `,
//       [id]
//     );

//     if (invoices.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" });
//     }

//     const [items] = await pool.execute(
//       "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//       [id]
//     );

//     const invoice = invoices[0];
//     invoice.items = items;

//     res.json({ invoice });
//   } catch (error) {
//     console.error("Invoice fetch error:", error);
//     res.status(500).json({ error: "Failed to fetch invoice" });
//   }
// });

// // Create new invoice
// router.post(
//   "/",
//   authenticateToken,
//   [
//     body("customerId").notEmpty().withMessage("Customer ID is required"),
//     body("amount").optional().isNumeric().withMessage("Amount must be numeric"),
//     body("tax").optional().isNumeric().withMessage("Tax must be numeric"),
//     body("total").optional().isNumeric().withMessage("Total must be numeric"),
//     body("status")
//       .optional()
//       .isIn(["draft", "sent", "paid", "overdue", "cancelled"])
//       .withMessage("Invalid status"),
//     body("dueDate")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date must be a valid date"),
//     body("items")
//       .isArray({ min: 1 })
//       .withMessage("Items array is required with at least one item"),
//     body("items.*.description")
//       .notEmpty()
//       .withMessage("Item description is required"),
//     body("items.*.quantity")
//       .isInt({ min: 1 })
//       .withMessage("Item quantity must be a positive integer"),
//     body("items.*.rate").isNumeric().withMessage("Item rate must be numeric"),
//     body("items.*.amount")
//       .isNumeric()
//       .withMessage("Item amount must be numeric"),
//     body("notes").optional().isString().withMessage("Notes must be a string"),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const { customerId, items } = req.body;

//       // Load customer with defaults used for invoice generation
//       const [customers] = await pool.execute(
//         `
//         SELECT 
//           id,
//           assigned_to,
//           default_tax_rate,
//           default_due_days,
//           default_invoice_notes
//         FROM customers
//         WHERE id = ?
//       `,
//         [customerId]
//       );

//       if (customers.length === 0) {
//         return res.status(400).json({ error: "Customer not found" });
//       }

//       const customer = customers[0];

//       if (
//         req.user.role !== "admin" &&
//         customer.assigned_to !== req.user.userId
//       ) {
//         return res
//           .status(403)
//           .json({ error: "You do not have permission to invoice this customer" });
//       }

//       // Merge body with customer defaults (also normalizes dueDate to DATE)
//       const built = buildInvoiceFromCustomer(customer, req.body);

//       const invoiceNumber = generateInvoiceNumber();
//       const invoiceId = uuidv4();

//       const connection = await pool.getConnection();
//       await connection.beginTransaction();

//       try {
//         await connection.execute(
//           `
//           INSERT INTO invoices (
//             id, customer_id, invoice_number, amount, tax, total, status, due_date, notes
//           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
//         `,
//           sanitizeParams(
//             invoiceId,
//             customerId,
//             invoiceNumber,
//             built.amount,
//             built.tax,
//             built.total,
//             built.status,
//             built.dueDate, // already YYYY-MM-DD
//             built.notes
//           )
//         );

//         for (const item of items) {
//           const itemId = uuidv4(); // use this if invoice_items.id is NOT auto_increment
//           await connection.execute(
//             `
//             INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount)
//             VALUES (?, ?, ?, ?, ?, ?)
//           `,
//             sanitizeParams(
//               itemId,
//               invoiceId,
//               item.description,
//               item.quantity,
//               item.rate,
//               item.amount
//             )
//           );
//         }

//         await connection.commit();

//         const [createdInvoices] = await connection.execute(
//           `
//           SELECT 
//             i.*,
//             c.name AS customer_name,
//             c.company AS customer_company,
//             c.email AS customer_email
//           FROM invoices i
//           LEFT JOIN customers c ON i.customer_id = c.id
//           WHERE i.id = ?
//         `,
//           [invoiceId]
//         );

//         const [invoiceItems] = await connection.execute(
//           "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//           [invoiceId]
//         );

//         const invoice = createdInvoices[0];
//         invoice.items = invoiceItems;

//         res.status(201).json({
//           message: "Invoice created successfully",
//           invoice,
//         });
//       } catch (err) {
//         await connection.rollback();
//         throw err;
//       } finally {
//         connection.release();
//       }
//     } catch (error) {
//       console.error("Invoice creation error:", error);
//       res.status(500).json({ error: "Failed to create invoice" });
//     }
//   }
// );

// // Update invoice
// router.put(
//   "/:id",
//   authenticateToken,
//   [
//     body("customerId").optional().notEmpty().withMessage("Customer ID cannot be empty"),
//     body("amount").optional().isNumeric().withMessage("Amount must be numeric"),
//     body("tax").optional().isNumeric().withMessage("Tax must be numeric"),
//     body("total").optional().isNumeric().withMessage("Total must be numeric"),
//     body("status")
//       .optional()
//       .isIn(["draft", "sent", "paid", "overdue", "cancelled"])
//       .withMessage("Invalid status"),
//     body("dueDate")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date must be a valid date"),
//     body("paidDate")
//       .optional()
//       .isISO8601()
//       .withMessage("Paid date must be a valid date"),
//     body("items").optional().isArray().withMessage("Items must be an array"),
//     body("items.*.description")
//       .optional()
//       .notEmpty()
//       .withMessage("Item description cannot be empty"),
//     body("items.*.quantity")
//       .optional()
//       .isInt({ min: 1 })
//       .withMessage("Item quantity must be a positive integer"),
//     body("items.*.rate")
//       .optional()
//       .isNumeric()
//       .withMessage("Item rate must be numeric"),
//     body("items.*.amount")
//       .optional()
//       .isNumeric()
//       .withMessage("Item amount must be numeric"),
//     body("notes").optional().isString().withMessage("Notes must be a string"),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const { id } = req.params;
//       const updateData = { ...req.body };

//       const access = await ensureCanAccessInvoice(req, res, id);
//       if (!access.ok) return;

//       const [existingInvoices] = await pool.execute(
//         "SELECT id, status, customer_id FROM invoices WHERE id = ?",
//         [id]
//       );

//       if (existingInvoices.length === 0) {
//         return res.status(404).json({ error: "Invoice not found" });
//       }

//       if (updateData.customerId) {
//         const [customers] = await pool.execute(
//           "SELECT id, assigned_to FROM customers WHERE id = ?",
//           [updateData.customerId]
//         );

//         if (customers.length === 0) {
//           return res.status(400).json({ error: "Customer not found" });
//         }

//         if (
//           req.user.role !== "admin" &&
//           customers[0].assigned_to !== req.user.userId
//         ) {
//           return res.status(403).json({
//             error: "You do not have permission to set this customer on invoice",
//           });
//         }
//       }

//       // normalize date fields before building query
//       if (updateData.dueDate) {
//         updateData.dueDate = toSqlDate(updateData.dueDate);
//       }
//       if (updateData.paidDate) {
//         updateData.paidDate = toSqlDate(updateData.paidDate);
//       }

//       const connection = await pool.getConnection();
//       await connection.beginTransaction();

//       try {
//         const updateFields = [];
//         const updateValues = [];

//         Object.entries(updateData).forEach(([key, value]) => {
//           if (key === "items" || value === undefined) return;
//           const dbField = invoiceFieldMap[key];
//           if (!dbField) return;

//           updateFields.push(`${dbField} = ?`);
//           updateValues.push(value);
//         });

//         const currentInvoice = existingInvoices[0];
//         if (
//           updateData.status === "paid" &&
//           currentInvoice.status !== "paid" &&
//           !updateData.paidDate
//         ) {
//           updateFields.push("paid_date = CURRENT_DATE");
//         }

//         if (updateFields.length > 0) {
//           updateValues.push(id);
//           await connection.execute(
//             `UPDATE invoices SET ${updateFields.join(
//               ", "
//             )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
//             sanitizeParams(...updateValues)
//           );
//         }

//         if (Array.isArray(updateData.items)) {
//           await connection.execute(
//             "DELETE FROM invoice_items WHERE invoice_id = ?",
//             [id]
//           );

//           for (const item of updateData.items) {
//             const itemId = uuidv4(); // again, only needed if invoice_items.id is not AUTO_INCREMENT
//             await connection.execute(
//               `
//               INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount)
//               VALUES (?, ?, ?, ?, ?, ?)
//             `,
//               sanitizeParams(
//                 itemId,
//                 id,
//                 item.description,
//                 item.quantity,
//                 item.rate,
//                 item.amount
//               )
//             );
//           }
//         }

//         await connection.commit();

//         const [invoices] = await connection.execute(
//           `
//           SELECT 
//             i.*,
//             c.name AS customer_name,
//             c.company AS customer_company,
//             c.email AS customer_email
//           FROM invoices i
//           LEFT JOIN customers c ON i.customer_id = c.id
//           WHERE i.id = ?
//         `,
//           [id]
//         );

//         const [invoiceItems] = await connection.execute(
//           "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//           [id]
//         );

//         const invoice = invoices[0];
//         invoice.items = invoiceItems;

//         res.json({
//           message: "Invoice updated successfully",
//           invoice,
//         });
//       } catch (err) {
//         await connection.rollback();
//         throw err;
//       } finally {
//         connection.release();
//       }
//     } catch (error) {
//       console.error("Invoice update error:", error);
//       res.status(500).json({ error: "Failed to update invoice" });
//     }
//   }
// );

// // Delete invoice
// router.delete("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;

//     const access = await ensureCanAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [existingInvoices] = await pool.execute(
//       "SELECT id FROM invoices WHERE id = ?",
//       [id]
//     );

//     if (existingInvoices.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" });
//     }

//     await pool.execute("DELETE FROM invoices WHERE id = ?", [id]);

//     res.json({ message: "Invoice deleted successfully" });
//   } catch (error) {
//     console.error("Invoice deletion error:", error);
//     res.status(500).json({ error: "Failed to delete invoice" });
//   }
// });

// // Get invoice statistics
// router.get("/stats/overview", authenticateToken, async (req, res) => {
//   try {
//     let whereClause = "WHERE 1=1";
//     const params = [];

//     if (req.user.role !== "admin") {
//       whereClause += " AND c.assigned_to = ?";
//       params.push(req.user.userId);
//     }

//     const [stats] = await pool.execute(
//       `
//       SELECT 
//         i.status,
//         COUNT(*) AS count,
//         SUM(i.total) AS total_amount
//       FROM invoices i
//       LEFT JOIN customers c ON i.customer_id = c.id
//       ${whereClause}
//       GROUP BY i.status
//     `,
//       sanitizeParams(...params)
//     );

//     const [monthlyStats] = await pool.execute(
//       `
//       SELECT 
//         DATE_FORMAT(i.created_at, '%Y-%m') AS month,
//         COUNT(*) AS count,
//         SUM(i.total) AS total_amount
//       FROM invoices i
//       LEFT JOIN customers c ON i.customer_id = c.id
//       ${whereClause}
//       AND i.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
//       GROUP BY DATE_FORMAT(i.created_at, '%Y-%m')
//       ORDER BY month
//     `,
//       sanitizeParams(...params)
//     );

//     const [overdueInvoices] = await pool.execute(
//       `
//       SELECT COUNT(*) AS count, SUM(i.total) AS total_amount
//       FROM invoices i
//       LEFT JOIN customers c ON i.customer_id = c.id
//       ${whereClause}
//       AND i.status IN ('sent', 'overdue') AND i.due_date < CURDATE()
//     `,
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


//testing for new changes (16-12-2025)

// const { v4: uuidv4 } = require("uuid")
// const PDFDocument = require("pdfkit")

// const express = require("express")
// const { body, validationResult, query } = require("express-validator")
// const { pool } = require("../config/database")
// const { authenticateToken } = require("../middleware/auth")
// const { generateInvoiceNumber } = require("../utils/helpers")

// const router = express.Router()

// // Helper: convert undefined to null for MySQL compatibility
// const sanitizeParams = (...params) => {
//   return params.map((param) => (param === undefined ? null : param))
// }

// // Helper: normalize Date/ISO string to MySQL DATE (YYYY-MM-DD)
// const toSqlDate = (value) => {
//   if (!value) return null
//   const d = value instanceof Date ? value : new Date(value)
//   if (Number.isNaN(d.getTime())) return null
//   const y = d.getFullYear()
//   const m = String(d.getMonth() + 1).padStart(2, "0")
//   const day = String(d.getDate()).padStart(2, "0")
//   return `${y}-${m}-${day}`
// }

// // Helpers
// const handleValidation = (req, res) => {
//   const errors = validationResult(req)
//   if (!errors.isEmpty()) {
//     res.status(400).json({
//       error: "Validation failed",
//       details: errors.array(),
//     })
//     return true
//   }
//   return false
// }

// const invoiceFieldMap = {
//   customerId: "customer_id",
//   amount: "amount",
//   tax: "tax",
//   total: "total",
//   status: "status",
//   dueDate: "due_date",
//   paidDate: "paid_date",
//   notes: "notes",
// }

// // Build invoice values from customer + request body
// // With new semantics:
// // - amount = total amount before GST
// // - tax   = GST rate (e.g. 18)
// // - total = total payable with GST
// const buildInvoiceFromCustomer = (customer, body) => {
//   const { amount, tax, total, status, dueDate, notes, items } = body

//   // If amount not provided, derive from items
//   let derivedAmount = amount
//   if (derivedAmount === undefined && Array.isArray(items)) {
//     derivedAmount = items.reduce(
//       (sum, item) => sum + Number(item.amount || 0),
//       0,
//     )
//   }

//   const defaultTaxRate = customer.default_tax_rate ?? 0
//   const finalAmount = Number(derivedAmount || 0)

//   // If caller supplied tax (GST rate), use it; else fall back to default_tax_rate
//   const finalTax =
//     tax !== undefined
//       ? Number(tax)
//       : defaultTaxRate || 0

//   // If caller supplied total, use it; else compute using finalTax as rate
//   const finalTotal =
//     total !== undefined
//       ? Number(total)
//       : finalAmount + (finalAmount * finalTax) / 100

//   // Due date: use body.dueDate if provided, else today + customer.default_due_days (fallback 7)
//   let finalDueDate
//   if (dueDate) {
//     finalDueDate = toSqlDate(dueDate)
//   } else {
//     const dueDays = customer.default_due_days ?? 7
//     const d = new Date()
//     d.setDate(d.getDate() + Number(dueDays))
//     finalDueDate = toSqlDate(d)
//   }

//   const finalStatus = status || "draft"
//   const finalNotes = notes ?? customer.default_invoice_notes ?? null

//   return {
//     amount: finalAmount,
//     tax: finalTax,
//     total: finalTotal,
//     status: finalStatus,
//     dueDate: finalDueDate,
//     notes: finalNotes,
//   }
// }

// // helper: ensure current user can access invoice (via customer.assigned_to)
// const ensureCanAccessInvoice = async (req, res, invoiceId) => {
//   if (req.user.role === "admin") return { ok: true }

//   const [rows] = await pool.execute(
//     `
//       SELECT i.id
//       FROM invoices i
//       INNER JOIN customers c ON i.customer_id = c.id
//       WHERE i.id = ? AND c.assigned_to = ?
//     `,
//     sanitizeParams(invoiceId, req.user.userId),
//   )

//   if (rows.length === 0) {
//     return {
//       ok: false,
//       response: res
//         .status(403)
//         .json({ error: "You do not have permission to access this invoice" }),
//     }
//   }

//   return { ok: true }
// }

// // Get all invoices with filtering and pagination
// router.get(
//   "/",
//   authenticateToken,
//   [
//     query("page")
//       .optional()
//       .isInt({ min: 1 })
//       .withMessage("Page must be a positive integer"),
//     query("limit")
//       .optional()
//       .isInt({ min: 1, max: 100 })
//       .withMessage("Limit must be between 1 and 100"),
//     query("search").optional().isString().withMessage("Search must be a string"),
//     query("status")
//       .optional()
//       .isIn(["draft", "sent", "paid", "overdue", "cancelled"])
//       .withMessage("Invalid status"),
//     query("customerId").optional().isString().withMessage("Customer ID must be a string"),
//     query("dueDateFrom")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date from must be a valid date"),
//     query("dueDateTo")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date to must be a valid date"),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return

//       const pageRaw = Number.parseInt(req.query.page, 10)
//       const limitRaw = Number.parseInt(req.query.limit, 10)

//       const page = !Number.isNaN(pageRaw) && pageRaw > 0 ? pageRaw : 1
//       const limit =
//         !Number.isNaN(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 10
//       const offset = (page - 1) * limit

//       if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
//         return res.status(400).json({ error: "Invalid pagination parameters" })
//       }

//       const { search, status, customerId, dueDateFrom, dueDateTo } = req.query

//       let whereClause = "WHERE 1=1"
//       const queryParams = []

//       if (req.user.role !== "admin") {
//         whereClause += " AND c.assigned_to = ?"
//         queryParams.push(req.user.userId)
//       }

//       if (search) {
//         whereClause +=
//           " AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.company LIKE ?)"
//         const searchTerm = `%${search}%`
//         queryParams.push(searchTerm, searchTerm, searchTerm)
//       }

//       if (status) {
//         whereClause += " AND i.status = ?"
//         queryParams.push(status)
//       }

//       if (customerId) {
//         whereClause += " AND i.customer_id = ?"
//         queryParams.push(customerId)
//       }

//       if (dueDateFrom) {
//         whereClause += " AND i.due_date >= ?"
//         queryParams.push(dueDateFrom)
//       }

//       if (dueDateTo) {
//         whereClause += " AND i.due_date <= ?"
//         queryParams.push(dueDateTo)
//       }

//       // LIMIT/OFFSET as literal ints
//       const invoicesSql = `
//         SELECT 
//           i.*,
//           c.name AS customer_name,
//           c.company AS customer_company,
//           c.email AS customer_email
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//         ORDER BY i.created_at DESC
//         LIMIT ${Number(limit)} OFFSET ${Number(offset)}
//       `

//       const [invoices] = await pool.execute(invoicesSql, queryParams)

//       const countSql = `
//         SELECT COUNT(*) AS total 
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//       `
//       const [countResult] = await pool.execute(countSql, queryParams)

//       const total = countResult[0]?.total || 0
//       const totalPages = total > 0 ? Math.ceil(total / limit) : 1

//       res.json({
//         invoices,
//         pagination: {
//           page,
//           limit,
//           total,
//           totalPages,
//           hasNext: page < totalPages,
//           hasPrev: page > 1,
//         },
//       })
//     } catch (error) {
//       console.error("Invoices fetch error:", error)
//       res.status(500).json({ error: "Failed to fetch invoices" })
//     }
//   },
// )

// // Get invoice by ID with items
// router.get("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params

//     const access = await ensureCanAccessInvoice(req, res, id)
//     if (!access.ok) return

//     const [invoices] = await pool.execute(
//       `
//         SELECT 
//           i.*,
//           c.name AS customer_name,
//           c.company AS customer_company,
//           c.email AS customer_email,
//           c.phone AS customer_phone,
//           c.address AS customer_address,
//           c.city AS customer_city,
//           c.state AS customer_state,
//           c.zip_code AS customer_zip_code,
//           c.country AS customer_country
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         WHERE i.id = ?
//       `,
//       [id],
//     )

//     if (invoices.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" })
//     }

//     const [items] = await pool.execute(
//       "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//       [id],
//     )

//     const invoice = invoices[0]
//     invoice.items = items

//     res.json({ invoice })
//   } catch (error) {
//     console.error("Invoice fetch error:", error)
//     res.status(500).json({ error: "Failed to fetch invoice" })
//   }
// })

// // Download invoice as PDF
// // router.get("/:id/download", authenticateToken, async (req, res) => {
// //   try {
// //     const { id } = req.params

// //     const access = await ensureCanAccessInvoice(req, res, id)
// //     if (!access.ok) return

// //     // Load invoice + customer
// //     const [invoices] = await pool.execute(
// //       `
// //         SELECT 
// //           i.*,
// //           c.name AS customer_name,
// //           c.address AS customer_address,
// //           c.city AS customer_city,
// //           c.state AS customer_state,
// //           c.zip_code AS customer_zip_code,
// //           c.country AS customer_country
// //         FROM invoices i
// //         LEFT JOIN customers c ON i.customer_id = c.id
// //         WHERE i.id = ?
// //       `,
// //       [id],
// //     )

// //     if (invoices.length === 0) {
// //       return res.status(404).json({ error: "Invoice not found" })
// //     }

// //     const [items] = await pool.execute(
// //       "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
// //       [id],
// //     )

// //     const invoice = invoices[0]
// //     const serviceItem = items[0] || null

// //     const subtotal =
// //       items.reduce((sum, item) => sum + Number(item.amount || 0), 0) ||
// //       Number(invoice.amount || 0)
// //     const gstRate = Number(invoice.tax || 18)
// //     const gstAmount = (subtotal * gstRate) / 100
// //     const totalWithGst = subtotal + gstAmount

// //     const customerName = invoice.customer_name || ""
// //     const customerAddress = [
// //       invoice.customer_address,
// //       invoice.customer_city,
// //       invoice.customer_state,
// //       invoice.customer_zip_code,
// //       invoice.customer_country,
// //     ]
// //       .filter(Boolean)
// //       .join(", ")

// //     const issueDate = invoice.issue_date
// //       ? new Date(invoice.issue_date).toLocaleDateString("en-IN")
// //       : ""
// //     const dueDate = invoice.due_date
// //       ? new Date(invoice.due_date).toLocaleDateString("en-IN")
// //       : ""

// //     // Generate PDF
// //     const doc = new PDFDocument({ margin: 50 })

// //     res.setHeader("Content-Type", "application/pdf")
// //     res.setHeader(
// //       "Content-Disposition",
// //       `attachment; filename="invoice-${invoice.invoice_number}.pdf"`,
// //     )

// //     doc.pipe(res)

// //     // Header: Invoice title
// //     doc.fontSize(18).text("INVOICE", { align: "right" }).moveDown()

// //     // Customer details
// //     doc
// //       .fontSize(12)
// //       .text(`Customer name: ${customerName}`)
// //       .text(`Customer address: ${customerAddress}`)
// //       .moveDown()

// //     // Date + invoice number
// //     doc.text(`Date: ${dueDate || issueDate}`).text(`Invoice number: ${invoice.invoice_number}`).moveDown()

// //     // Service table header
// //     doc
// //       .fontSize(12)
// //       .text("Sr. No", 50, doc.y, { continued: true })
// //       .text("Service", 120, doc.y, { continued: true })
// //       .text("Charges (₹)", 400, doc.y)
// //     doc.moveTo(50, doc.y + 2).lineTo(550, doc.y + 2).stroke()
// //     doc.moveDown(0.5)

// //     // Single service row
// //     if (serviceItem) {
// //       doc
// //         .text("1", 50, doc.y, { continued: true })
// //         .text(serviceItem.description || "Service", 120, doc.y, {
// //           continued: true,
// //         })
// //         .text(subtotal.toFixed(2), 400, doc.y)
// //       doc.moveDown()
// //     }

// //     doc.moveDown()

// //     // Totals
// //     doc
// //       .text(`Total amount: ₹${subtotal.toFixed(2)}`)
// //       .text(`GST: ${gstRate}% (₹${gstAmount.toFixed(2)})`)
// //       .text(
// //         `Total payable amount with GST: ₹${totalWithGst.toFixed(2)}`,
// //       )

// //     if (invoice.notes) {
// //       doc.moveDown().text("Notes:", { underline: true }).text(invoice.notes)
// //     }

// //     doc.end()
// //   } catch (error) {
// //     console.error("Invoice PDF error:", error)
// //     res.status(500).json({ error: "Failed to generate invoice PDF" })
// //   }
// // })

// //test 
// router.get("/:id/download", async (req, res) => {
//   try {
//     const { id } = req.params

//     // Load invoice + customer
//     const [invoices] = await pool.execute(
//       `
//         SELECT 
//           i.*,
//           c.name AS customer_name,
//           c.address AS customer_address,
//           c.city AS customer_city,
//           c.state AS customer_state,
//           c.zip_code AS customer_zip_code,
//           c.country AS customer_country
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         WHERE i.id = ?
//       `,
//       [id],
//     )

//     if (invoices.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" })
//     }

//     const [items] = await pool.execute(
//       "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//       [id],
//     )

//     const invoice = invoices[0]
//     const serviceItem = items[0] || null

//     const subtotal =
//       items.reduce((sum, item) => sum + Number(item.amount || 0), 0) ||
//       Number(invoice.amount || 0)
//     const gstRate = Number(invoice.tax || 18)
//     const gstAmount = (subtotal * gstRate) / 100
//     const totalWithGst = subtotal + gstAmount

//     const customerName = invoice.customer_name || ""
//     const customerAddress = [
//       invoice.customer_address,
//       invoice.customer_city,
//       invoice.customer_state,
//       invoice.customer_zip_code,
//       invoice.customer_country,
//     ]
//       .filter(Boolean)
//       .join(", ")

//     const formatPdfDate = (value) => {
//       if (!value) return ""
//       const d = new Date(value)
//       if (Number.isNaN(d.getTime())) return ""
//       const dd = String(d.getDate()).padStart(2, "0")
//       const mm = String(d.getMonth() + 1).padStart(2, "0")
//       const yyyy = d.getFullYear()
//       return `${dd}/${mm}/${yyyy}`
//     }

//     const issueDate = formatPdfDate(invoice.issue_date)
//     const dueDate = formatPdfDate(invoice.due_date)

//     const doc = new PDFDocument({ margin: 50 })

//     res.setHeader("Content-Type", "application/pdf")
//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename="invoice-${invoice.invoice_number}.pdf"`,
//     )

//     doc.pipe(res)

//     // Title
//     doc.fontSize(20).text("INVOICE", { align: "right" }).moveDown(1.5)

//     // Customer + invoice info in two columns
//     const leftX = 50
//     const rightX = 320

//     doc
//       .fontSize(12)
//       .text(`Customer name: ${customerName}`, leftX)
//       .text(`Customer address: ${customerAddress}`, leftX)
//       .moveDown()

//     doc
//       .text(`Issue date: ${issueDate}`, rightX)
//       .text(`Due date: ${dueDate}`, rightX)
//       .text(`Invoice number: ${invoice.invoice_number}`, rightX)
//       .moveDown(2)

//     // Service table header
//     const tableTop = doc.y
//     const colSrNoX = 50
//     const colServiceX = 100
//     const colChargesX = 420

//     doc
//       .fontSize(12)
//       .text("Sr. No", colSrNoX, tableTop)
//       .text("Service", colServiceX, tableTop)
//       .text("Charges (₹)", colChargesX, tableTop, { align: "right" })

//     const headerBottomY = tableTop + 18
//     doc
//       .moveTo(colSrNoX, headerBottomY)
//       .lineTo(550, headerBottomY)
//       .stroke()

//     // Single service row
//     let rowY = headerBottomY + 8

//     if (serviceItem) {
//       doc
//         .text("1", colSrNoX, rowY)
//         .text(serviceItem.description || "Service", colServiceX, rowY, {
//           width: colChargesX - colServiceX - 10,
//         })
//         .text(subtotal.toFixed(2), colChargesX, rowY, {
//           align: "right",
//         })

//       rowY += 20
//     }

//     doc.moveTo(colSrNoX, rowY).lineTo(550, rowY).stroke()
//     doc.moveDown(2)

//     // Totals section, right aligned
//     const totalsX = 320

//     doc
//       .fontSize(12)
//       .text(`Total amount (before GST):`, totalsX, rowY + 10)
//       .text(`₹${subtotal.toFixed(2)}`, 480, rowY + 10, { align: "right" })

//     doc
//       .text(
//         `GST: ${gstRate}% (on total amount)`,
//         totalsX,
//         doc.y + 5,
//       )
//       .text(`₹${gstAmount.toFixed(2)}`, 480, doc.y - 12, {
//         align: "right",
//       })

//     doc
//       .moveTo(totalsX, doc.y + 8)
//       .lineTo(550, doc.y + 8)
//       .stroke()

//     doc
//       .fontSize(13)
//       .text(
//         `Total payable amount with GST:`,
//         totalsX,
//         doc.y + 12,
//       )
//       .text(`₹${totalWithGst.toFixed(2)}`, 480, doc.y - 14, {
//         align: "right",
//       })

//     // Notes
//     if (invoice.notes) {
//       doc.moveDown(3)
//       doc.fontSize(12).text("Notes:", { underline: true })
//       doc.moveDown(0.5)
//       doc.text(invoice.notes, {
//         width: 500,
//       })
//     }

//     doc.end()
//   } catch (error) {
//     console.error("Invoice PDF error:", error)
//     res.status(500).json({ error: "Failed to generate invoice PDF" })
//   }
// })


// // Create new invoice
// router.post(
//   "/",
//   authenticateToken,
//   [
//     body("customerId").notEmpty().withMessage("Customer ID is required"),
//     body("amount").optional().isNumeric().withMessage("Amount must be numeric"),
//     body("tax").optional().isNumeric().withMessage("Tax must be numeric"),
//     body("total").optional().isNumeric().withMessage("Total must be numeric"),
//     body("status")
//       .optional()
//       .isIn(["draft", "sent", "paid", "overdue", "cancelled"])
//       .withMessage("Invalid status"),
//     body("dueDate")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date must be a valid date"),
//     body("items")
//       .isArray({ min: 1 })
//       .withMessage("Items array is required with at least one item"),
//     body("items.*.description")
//       .notEmpty()
//       .withMessage("Item description is required"),
//     body("items.*.quantity")
//       .isInt({ min: 1 })
//       .withMessage("Item quantity must be a positive integer"),
//     body("items.*.rate").isNumeric().withMessage("Item rate must be numeric"),
//     body("items.*.amount")
//       .isNumeric()
//       .withMessage("Item amount must be numeric"),
//     body("notes").optional().isString().withMessage("Notes must be a string"),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return

//       const { customerId, items } = req.body

//       // Load customer with defaults used for invoice generation
//       const [customers] = await pool.execute(
//         `
//           SELECT 
//             id,
//             assigned_to,
//             default_tax_rate,
//             default_due_days,
//             default_invoice_notes
//           FROM customers
//           WHERE id = ?
//         `,
//         [customerId],
//       )

//       if (customers.length === 0) {
//         return res.status(400).json({ error: "Customer not found" })
//       }

//       const customer = customers[0]

//       if (
//         req.user.role !== "admin" &&
//         customer.assigned_to !== req.user.userId
//       ) {
//         return res
//           .status(403)
//           .json({ error: "You do not have permission to invoice this customer" })
//       }

//       // Merge body with customer defaults (also normalizes dueDate to DATE)
//       const built = buildInvoiceFromCustomer(customer, req.body)

//       const invoiceNumber = generateInvoiceNumber()
//       const invoiceId = uuidv4()

//       const connection = await pool.getConnection()
//       await connection.beginTransaction()

//       try {
//         await connection.execute(
//           `
//             INSERT INTO invoices (
//               id, customer_id, invoice_number, amount, tax, total, status, due_date, notes
//             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
//           `,
//           sanitizeParams(
//             invoiceId,
//             customerId,
//             invoiceNumber,
//             built.amount,
//             built.tax,
//             built.total,
//             built.status,
//             built.dueDate, // already YYYY-MM-DD
//             built.notes,
//           ),
//         )

//         for (const item of items) {
//           const itemId = uuidv4()
//           await connection.execute(
//             `
//               INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount)
//               VALUES (?, ?, ?, ?, ?, ?)
//             `,
//             sanitizeParams(
//               itemId,
//               invoiceId,
//               item.description,
//               item.quantity,
//               item.rate,
//               item.amount,
//             ),
//           )
//         }

//         await connection.commit()

//         const [createdInvoices] = await connection.execute(
//           `
//             SELECT 
//               i.*,
//               c.name AS customer_name,
//               c.company AS customer_company,
//               c.email AS customer_email
//             FROM invoices i
//             LEFT JOIN customers c ON i.customer_id = c.id
//             WHERE i.id = ?
//           `,
//           [invoiceId],
//         )

//         const [invoiceItems] = await connection.execute(
//           "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//           [invoiceId],
//         )

//         const invoice = createdInvoices[0]
//         invoice.items = invoiceItems

//         res.status(201).json({
//           message: "Invoice created successfully",
//           invoice,
//         })
//       } catch (err) {
//         await connection.rollback()
//         throw err
//       } finally {
//         connection.release()
//       }
//     } catch (error) {
//       console.error("Invoice creation error:", error)
//       res.status(500).json({ error: "Failed to create invoice" })
//     }
//   },
// )

// // Update invoice
// router.put(
//   "/:id",
//   authenticateToken,
//   [
//     body("customerId").optional().notEmpty().withMessage("Customer ID cannot be empty"),
//     body("amount").optional().isNumeric().withMessage("Amount must be numeric"),
//     body("tax").optional().isNumeric().withMessage("Tax must be numeric"),
//     body("total").optional().isNumeric().withMessage("Total must be numeric"),
//     body("status")
//       .optional()
//       .isIn(["draft", "sent", "paid", "overdue", "cancelled"])
//       .withMessage("Invalid status"),
//     body("dueDate")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date must be a valid date"),
//     body("paidDate")
//       .optional()
//       .isISO8601()
//       .withMessage("Paid date must be a valid date"),
//     body("items").optional().isArray().withMessage("Items must be an array"),
//     body("items.*.description")
//       .optional()
//       .notEmpty()
//       .withMessage("Item description cannot be empty"),
//     body("items.*.quantity")
//       .optional()
//       .isInt({ min: 1 })
//       .withMessage("Item quantity must be a positive integer"),
//     body("items.*.rate")
//       .optional()
//       .isNumeric()
//       .withMessage("Item rate must be numeric"),
//     body("items.*.amount")
//       .optional()
//       .isNumeric()
//       .withMessage("Item amount must be numeric"),
//     body("notes").optional().isString().withMessage("Notes must be a string"),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return

//       const { id } = req.params
//       const updateData = { ...req.body }

//       const access = await ensureCanAccessInvoice(req, res, id)
//       if (!access.ok) return

//       const [existingInvoices] = await pool.execute(
//         "SELECT id, status, customer_id FROM invoices WHERE id = ?",
//         [id],
//       )

//       if (existingInvoices.length === 0) {
//         return res.status(404).json({ error: "Invoice not found" })
//       }

//       if (updateData.customerId) {
//         const [customers] = await pool.execute(
//           "SELECT id, assigned_to FROM customers WHERE id = ?",
//           [updateData.customerId],
//         )

//         if (customers.length === 0) {
//           return res.status(400).json({ error: "Customer not found" })
//         }

//         if (
//           req.user.role !== "admin" &&
//           customers[0].assigned_to !== req.user.userId
//         ) {
//           return res.status(403).json({
//             error: "You do not have permission to set this customer on invoice",
//           })
//         }
//       }

//       // normalize date fields before building query
//       if (updateData.dueDate) {
//         updateData.dueDate = toSqlDate(updateData.dueDate)
//       }
//       if (updateData.paidDate) {
//         updateData.paidDate = toSqlDate(updateData.paidDate)
//       }

//       const connection = await pool.getConnection()
//       await connection.beginTransaction()

//       try {
//         const updateFields = []
//         const updateValues = []

//         Object.entries(updateData).forEach(([key, value]) => {
//           if (key === "items" || value === undefined) return
//           const dbField = invoiceFieldMap[key]
//           if (!dbField) return

//           updateFields.push(`${dbField} = ?`)
//           updateValues.push(value)
//         })

//         const currentInvoice = existingInvoices[0]
//         if (
//           updateData.status === "paid" &&
//           currentInvoice.status !== "paid" &&
//           !updateData.paidDate
//         ) {
//           updateFields.push("paid_date = CURRENT_DATE")
//         }

//         if (updateFields.length > 0) {
//           updateValues.push(id)
//           await connection.execute(
//             `UPDATE invoices SET ${updateFields.join(
//               ", ",
//             )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
//             sanitizeParams(...updateValues),
//           )
//         }

//         if (Array.isArray(updateData.items)) {
//           await connection.execute(
//             "DELETE FROM invoice_items WHERE invoice_id = ?",
//             [id],
//           )

//           for (const item of updateData.items) {
//             const itemId = uuidv4()
//             await connection.execute(
//               `
//                 INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount)
//                 VALUES (?, ?, ?, ?, ?, ?)
//               `,
//               sanitizeParams(
//                 itemId,
//                 id,
//                 item.description,
//                 item.quantity,
//                 item.rate,
//                 item.amount,
//               ),
//             )
//           }
//         }

//         await connection.commit()

//         const [invoices] = await connection.execute(
//           `
//             SELECT 
//               i.*,
//               c.name AS customer_name,
//               c.company AS customer_company,
//               c.email AS customer_email
//             FROM invoices i
//             LEFT JOIN customers c ON i.customer_id = c.id
//             WHERE i.id = ?
//           `,
//           [id],
//         )

//         const [invoiceItems] = await connection.execute(
//           "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//           [id],
//         )

//         const invoice = invoices[0]
//         invoice.items = invoiceItems

//         res.json({
//           message: "Invoice updated successfully",
//           invoice,
//         })
//       } catch (err) {
//         await connection.rollback()
//         throw err
//       } finally {
//         connection.release()
//       }
//     } catch (error) {
//       console.error("Invoice update error:", error)
//       res.status(500).json({ error: "Failed to update invoice" })
//     }
//   },
// )

// // Delete invoice
// router.delete("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params

//     const access = await ensureCanAccessInvoice(req, res, id)
//     if (!access.ok) return

//     const [existingInvoices] = await pool.execute(
//       "SELECT id FROM invoices WHERE id = ?",
//       [id],
//     )

//     if (existingInvoices.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" })
//     }

//     await pool.execute("DELETE FROM invoices WHERE id = ?", [id])

//     res.json({ message: "Invoice deleted successfully" })
//   } catch (error) {
//     console.error("Invoice deletion error:", error)
//     res.status(500).json({ error: "Failed to delete invoice" })
//   }
// })

// // Get invoice statistics
// router.get("/stats/overview", authenticateToken, async (req, res) => {
//   try {
//     let whereClause = "WHERE 1=1"
//     const params = []

//     if (req.user.role !== "admin") {
//       whereClause += " AND c.assigned_to = ?"
//       params.push(req.user.userId)
//     }

//     const [stats] = await pool.execute(
//       `
//         SELECT 
//           i.status,
//           COUNT(*) AS count,
//           SUM(i.total) AS total_amount
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//         GROUP BY i.status
//       `,
//       sanitizeParams(...params),
//     )

//     const [monthlyStats] = await pool.execute(
//       `
//         SELECT 
//           DATE_FORMAT(i.created_at, '%Y-%m') AS month,
//           COUNT(*) AS count,
//           SUM(i.total) AS total_amount
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//         AND i.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
//         GROUP BY DATE_FORMAT(i.created_at, '%Y-%m')
//         ORDER BY month
//       `,
//       sanitizeParams(...params),
//     )

//     const [overdueInvoices] = await pool.execute(
//       `
//         SELECT COUNT(*) AS count, SUM(i.total) AS total_amount
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//         AND i.status IN ('sent', 'overdue') AND i.due_date < CURDATE()
//       `,
//       sanitizeParams(...params),
//     )

//     res.json({
//       statusBreakdown: stats,
//       monthlyTrend: monthlyStats,
//       overdue: overdueInvoices[0],
//     })
//   } catch (error) {
//     console.error("Invoice stats error:", error)
//     res.status(500).json({ error: "Failed to fetch invoice statistics" })
//   }
// })

// module.exports = router


//testing (19-12-2025)

// const { v4: uuidv4 } = require("uuid");
// const PDFDocument = require("pdfkit");

// const express = require("express");
// const { body, validationResult, query } = require("express-validator");
// const { pool } = require("../config/database");
// const { authenticateToken } = require("../middleware/auth");
// const { generateInvoiceNumber } = require("../utils/helpers");

// const router = express.Router();

// // Helper: convert undefined to null for MySQL compatibility
// const sanitizeParams = (...params) => {
//   return params.map((param) => (param === undefined ? null : param));
// };

// // Helper: normalize Date/ISO string to MySQL DATE (YYYY-MM-DD)
// const toSqlDate = (value) => {
//   if (!value) return null;
//   const d = value instanceof Date ? value : new Date(value);
//   if (Number.isNaN(d.getTime())) return null;
//   const y = d.getFullYear();
//   const m = String(d.getMonth() + 1).padStart(2, "0");
//   const day = String(d.getDate()).padStart(2, "0");
//   return `${y}-${m}-${day}`;
// };

// // Helpers
// const handleValidation = (req, res) => {
//   const errors = validationResult(req);
//   if (!errors.isEmpty()) {
//     res.status(400).json({
//       error: "Validation failed",
//       details: errors.array(),
//     });
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
//   dueDate: "due_date",
//   paidDate: "paid_date",
//   notes: "notes",
// };

// // Build invoice values from customer + request body
// // With new semantics:
// // - amount = total amount before GST
// // - tax   = GST rate (e.g. 18)
// // - total = total payable with GST
// const buildInvoiceFromCustomer = (customer, body) => {
//   const { amount, tax, total, status, dueDate, notes, items } = body;

//   // If amount not provided, derive from items
//   let derivedAmount = amount;
//   if (derivedAmount === undefined && Array.isArray(items)) {
//     derivedAmount = items.reduce(
//       (sum, item) => sum + Number(item.amount || 0),
//       0
//     );
//   }

//   const defaultTaxRate = customer.default_tax_rate ?? 0;
//   const finalAmount = Number(derivedAmount || 0);

//   // If caller supplied tax (GST rate), use it; else fall back to default_tax_rate
//   const finalTax =
//     tax !== undefined
//       ? Number(tax)
//       : defaultTaxRate || 0;

//   // If caller supplied total, use it; else compute using finalTax as rate
//   const finalTotal =
//     total !== undefined
//       ? Number(total)
//       : finalAmount + (finalAmount * finalTax) / 100;

//   // Due date: use body.dueDate if provided, else today + customer.default_due_days (fallback 7)
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
//     dueDate: finalDueDate,
//     notes: finalNotes,
//   };
// };

// // helper: ensure current user can access invoice (via customer.assigned_to)
// const ensureCanAccessInvoice = async (req, res, invoiceId) => {
//   if (req.user.role === "admin") return { ok: true };

//   const [rows] = await pool.execute(
//     `
//       SELECT i.id
//       FROM invoices i
//       INNER JOIN customers c ON i.customer_id = c.id
//       WHERE i.id = ? AND c.assigned_to = ?
//     `,
//     sanitizeParams(invoiceId, req.user.userId)
//   );

//   if (rows.length === 0) {
//     return {
//       ok: false,
//       response: res
//         .status(403)
//         .json({ error: "You do not have permission to access this invoice" }),
//     };
//   }

//   return { ok: true };
// };

// // Get all invoices with filtering and pagination
// router.get(
//   "/",
//   authenticateToken,
//   [
//     query("page")
//       .optional()
//       .isInt({ min: 1 })
//       .withMessage("Page must be a positive integer"),
//     query("limit")
//       .optional()
//       .isInt({ min: 1, max: 100 })
//       .withMessage("Limit must be between 1 and 100"),
//     query("search").optional().isString().withMessage("Search must be a string"),
//     query("status")
//       .optional()
//       .isIn(["draft", "sent", "paid", "overdue", "cancelled"])
//       .withMessage("Invalid status"),
//     query("customerId").optional().isString().withMessage("Customer ID must be a string"),
//     query("dueDateFrom")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date from must be a valid date"),
//     query("dueDateTo")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date to must be a valid date"),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const pageRaw = Number.parseInt(req.query.page, 10);
//       const limitRaw = Number.parseInt(req.query.limit, 10);

//       const page = !Number.isNaN(pageRaw) && pageRaw > 0 ? pageRaw : 1;
//       const limit =
//         !Number.isNaN(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 10;
//       const offset = (page - 1) * limit;

//       if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
//         return res.status(400).json({ error: "Invalid pagination parameters" });
//       }

//       const { search, status, customerId, dueDateFrom, dueDateTo } = req.query;

//       let whereClause = "WHERE 1=1";
//       const queryParams = [];

//       if (req.user.role !== "admin") {
//         whereClause += " AND c.assigned_to = ?";
//         queryParams.push(req.user.userId);
//       }

//       if (search) {
//         whereClause +=
//           " AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.company LIKE ?)";
//         const searchTerm = `%${search}%`;
//         queryParams.push(searchTerm, searchTerm, searchTerm);
//       }

//       if (status) {
//         whereClause += " AND i.status = ?";
//         queryParams.push(status);
//       }

//       if (customerId) {
//         whereClause += " AND i.customer_id = ?";
//         queryParams.push(customerId);
//       }

//       if (dueDateFrom) {
//         whereClause += " AND i.due_date >= ?";
//         queryParams.push(dueDateFrom);
//       }

//       if (dueDateTo) {
//         whereClause += " AND i.due_date <= ?";
//         queryParams.push(dueDateTo);
//       }

//       // LIMIT/OFFSET as literal ints
//       const invoicesSql = `
//         SELECT 
//           i.*,
//           c.name AS customer_name,
//           c.company AS customer_company,
//           c.email AS customer_email
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//         ORDER BY i.created_at DESC
//         LIMIT ${Number(limit)} OFFSET ${Number(offset)}
//       `;

//       const [invoices] = await pool.execute(
//         invoicesSql,
//         sanitizeParams(...queryParams)
//       );

//       const countSql = `
//         SELECT COUNT(*) AS total 
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//       `;
//       const [countResult] = await pool.execute(
//         countSql,
//         sanitizeParams(...queryParams)
//       );

//       const total = countResult[0]?.total || 0;
//       const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

//       res.json({
//         invoices,
//         pagination: {
//           page,
//           limit,
//           total,
//           totalPages,
//           hasNext: page < totalPages,
//           hasPrev: page > 1,
//         },
//       });
//     } catch (error) {
//       console.error("Invoices fetch error:", error);
//       res.status(500).json({ error: "Failed to fetch invoices" });
//     }
//   }
// );

// // Get invoice by ID with items
// router.get("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;

//     const access = await ensureCanAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [invoices] = await pool.execute(
//       `
//         SELECT 
//           i.*,
//           c.name AS customer_name,
//           c.company AS customer_company,
//           c.email AS customer_email,
//           c.phone AS customer_phone,
//           c.address AS customer_address,
//           c.city AS customer_city,
//           c.state AS customer_state,
//           c.zip_code AS customer_zip_code,
//           c.country AS customer_country
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         WHERE i.id = ?
//       `,
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
//     invoice.items = items;

//     res.json({ invoice });
//   } catch (error) {
//     console.error("Invoice fetch error:", error);
//     res.status(500).json({ error: "Failed to fetch invoice" });
//   }
// });

// // test PDF download (no auth)
// router.get("/:id/download", async (req, res) => {
//   try {
//     const { id } = req.params;

//     // Load invoice + customer
//     const [invoices] = await pool.execute(
//       `
//         SELECT 
//           i.*,
//           c.name AS customer_name,
//           c.address AS customer_address,
//           c.city AS customer_city,
//           c.state AS customer_state,
//           c.zip_code AS customer_zip_code,
//           c.country AS customer_country
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         WHERE i.id = ?
//       `,
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
//     const serviceItem = items[0] || null;

//     const subtotal =
//       items.reduce((sum, item) => sum + Number(item.amount || 0), 0) ||
//       Number(invoice.amount || 0);
//     const gstRate = Number(invoice.tax || 18);
//     const gstAmount = (subtotal * gstRate) / 100;
//     const totalWithGst = subtotal + gstAmount;

//     const customerName = invoice.customer_name || "";
//     const customerAddress = [
//       invoice.customer_address,
//       invoice.customer_city,
//       invoice.customer_state,
//       invoice.customer_zip_code,
//       invoice.customer_country,
//     ]
//       .filter(Boolean)
//       .join(", ");

//     const formatPdfDate = (value) => {
//       if (!value) return "";
//       const d = new Date(value);
//       if (Number.isNaN(d.getTime())) return "";
//       const dd = String(d.getDate()).padStart(2, "0");
//       const mm = String(d.getMonth() + 1).padStart(2, "0");
//       const yyyy = d.getFullYear();
//       return `${dd}/${mm}/${yyyy}`;
//     };

//     const issueDate = formatPdfDate(invoice.issue_date);
//     const dueDate = formatPdfDate(invoice.due_date);

//     const doc = new PDFDocument({ margin: 50 });

//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename="invoice-${invoice.invoice_number}.pdf"`
//     );

//     doc.pipe(res);

//     // Title
//     doc.fontSize(20).text("INVOICE", { align: "right" }).moveDown(1.5);

//     // Customer + invoice info in two columns
//     const leftX = 50;
//     const rightX = 320;

//     doc
//       .fontSize(12)
//       .text(`Customer name: ${customerName}`, leftX)
//       .text(`Customer address: ${customerAddress}`, leftX)
//       .moveDown();

//     doc
//       .text(`Issue date: ${issueDate}`, rightX)
//       .text(`Due date: ${dueDate}`, rightX)
//       .text(`Invoice number: ${invoice.invoice_number}`, rightX)
//       .moveDown(2);

//     // Service table header
//     const tableTop = doc.y;
//     const colSrNoX = 50;
//     const colServiceX = 100;
//     const colChargesX = 420;

//     doc
//       .fontSize(12)
//       .text("Sr. No", colSrNoX, tableTop)
//       .text("Service", colServiceX, tableTop)
//       .text("Charges (₹)", colChargesX, tableTop, { align: "right" });

//     const headerBottomY = tableTop + 18;
//     doc
//       .moveTo(colSrNoX, headerBottomY)
//       .lineTo(550, headerBottomY)
//       .stroke();

//     // Single service row
//     let rowY = headerBottomY + 8;

//     if (serviceItem) {
//       doc
//         .text("1", colSrNoX, rowY)
//         .text(serviceItem.description || "Service", colServiceX, rowY, {
//           width: colChargesX - colServiceX - 10,
//         })
//         .text(subtotal.toFixed(2), colChargesX, rowY, {
//           align: "right",
//         });

//       rowY += 20;
//     }

//     doc.moveTo(colSrNoX, rowY).lineTo(550, rowY).stroke();
//     doc.moveDown(2);

//     // Totals section, right aligned
//     const totalsX = 320;

//     doc
//       .fontSize(12)
//       .text(`Total amount (before GST):`, totalsX, rowY + 10)
//       .text(`₹${subtotal.toFixed(2)}`, 480, rowY + 10, { align: "right" });

//     doc
//       .text(
//         `GST: ${gstRate}% (on total amount)`,
//         totalsX,
//         doc.y + 5
//       )
//       .text(`₹${gstAmount.toFixed(2)}`, 480, doc.y - 12, {
//         align: "right",
//       });

//     doc
//       .moveTo(totalsX, doc.y + 8)
//       .lineTo(550, doc.y + 8)
//       .stroke();

//     doc
//       .fontSize(13)
//       .text(
//         `Total payable amount with GST:`,
//         totalsX,
//         doc.y + 12
//       )
//       .text(`₹${totalWithGst.toFixed(2)}`, 480, doc.y - 14, {
//         align: "right",
//       });

//     // Notes
//     if (invoice.notes) {
//       doc.moveDown(3);
//       doc.fontSize(12).text("Notes:", { underline: true });
//       doc.moveDown(0.5);
//       doc.text(invoice.notes, {
//         width: 500,
//       });
//     }

//     doc.end();
//   } catch (error) {
//     console.error("Invoice PDF error:", error);
//     res.status(500).json({ error: "Failed to generate invoice PDF" });
//   }
// });

// // Create new invoice
// router.post(
//   "/",
//   authenticateToken,
//   [
//     body("customerId").notEmpty().withMessage("Customer ID is required"),
//     body("amount").optional().isNumeric().withMessage("Amount must be numeric"),
//     body("tax").optional().isNumeric().withMessage("Tax must be numeric"),
//     body("total").optional().isNumeric().withMessage("Total must be numeric"),
//     body("status")
//       .optional()
//       .isIn(["draft", "sent", "paid", "overdue", "cancelled"])
//       .withMessage("Invalid status"),
//     body("dueDate")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date must be a valid date"),
//     body("items")
//       .isArray({ min: 1 })
//       .withMessage("Items array is required with at least one item"),
//     body("items.*.description")
//       .notEmpty()
//       .withMessage("Item description is required"),
//     body("items.*.quantity")
//       .isInt({ min: 1 })
//       .withMessage("Item quantity must be a positive integer"),
//     body("items.*.rate").isNumeric().withMessage("Item rate must be numeric"),
//     body("items.*.amount")
//       .isNumeric()
//       .withMessage("Item amount must be numeric"),
//     body("notes").optional().isString().withMessage("Notes must be a string"),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const { customerId, items } = req.body;

//       // Load customer with defaults used for invoice generation
//       const [customers] = await pool.execute(
//         `
//           SELECT 
//             id,
//             assigned_to,
//             default_tax_rate,
//             default_due_days,
//             default_invoice_notes
//           FROM customers
//           WHERE id = ?
//         `,
//         sanitizeParams(customerId)
//       );

//       if (customers.length === 0) {
//         return res.status(400).json({ error: "Customer not found" });
//       }

//       const customer = customers[0];

//       if (
//         req.user.role !== "admin" &&
//         customer.assigned_to !== req.user.userId
//       ) {
//         return res
//           .status(403)
//           .json({ error: "You do not have permission to invoice this customer" });
//       }

//       // Merge body with customer defaults (also normalizes dueDate to DATE)
//       const built = buildInvoiceFromCustomer(customer, req.body);

//       const invoiceNumber = generateInvoiceNumber();
//       const invoiceId = uuidv4();

//       const connection = await pool.getConnection();
//       await connection.beginTransaction();

//       try {
//         await connection.execute(
//           `
//             INSERT INTO invoices (
//               id, customer_id, invoice_number, amount, tax, total, status, due_date, notes
//             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
//           `,
//           sanitizeParams(
//             invoiceId,
//             customerId,
//             invoiceNumber,
//             built.amount,
//             built.tax,
//             built.total,
//             built.status,
//             built.dueDate, // already YYYY-MM-DD
//             built.notes
//           )
//         );

//         for (const item of items) {
//           const itemId = uuidv4();
//           await connection.execute(
//             `
//               INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount)
//               VALUES (?, ?, ?, ?, ?, ?)
//             `,
//             sanitizeParams(
//               itemId,
//               invoiceId,
//               item.description,
//               item.quantity,
//               item.rate,
//               item.amount
//             )
//           );
//         }

//         await connection.commit();

//         const [createdInvoices] = await connection.execute(
//           `
//             SELECT 
//               i.*,
//               c.name AS customer_name,
//               c.company AS customer_company,
//               c.email AS customer_email
//             FROM invoices i
//             LEFT JOIN customers c ON i.customer_id = c.id
//             WHERE i.id = ?
//           `,
//           sanitizeParams(invoiceId)
//         );

//         const [invoiceItems] = await connection.execute(
//           "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//           sanitizeParams(invoiceId)
//         );

//         const invoice = createdInvoices[0];
//         invoice.items = invoiceItems;

//         res.status(201).json({
//           message: "Invoice created successfully",
//           invoice,
//         });
//       } catch (err) {
//         await connection.rollback();
//         throw err;
//       } finally {
//         connection.release();
//       }
//     } catch (error) {
//       console.error("Invoice creation error:", error);
//       res.status(500).json({ error: "Failed to create invoice" });
//     }
//   }
// );

// // Update invoice
// router.put(
//   "/:id",
//   authenticateToken,
//   [
//     body("customerId").optional().notEmpty().withMessage("Customer ID cannot be empty"),
//     body("amount").optional().isNumeric().withMessage("Amount must be numeric"),
//     body("tax").optional().isNumeric().withMessage("Tax must be numeric"),
//     body("total").optional().isNumeric().withMessage("Total must be numeric"),
//     body("status")
//       .optional()
//       .isIn(["draft", "sent", "paid", "overdue", "cancelled"])
//       .withMessage("Invalid status"),
//     body("dueDate")
//       .optional()
//       .isISO8601()
//       .withMessage("Due date must be a valid date"),
//     body("paidDate")
//       .optional()
//       .isISO8601()
//       .withMessage("Paid date must be a valid date"),
//     body("items").optional().isArray().withMessage("Items must be an array"),
//     body("items.*.description")
//       .optional()
//       .notEmpty()
//       .withMessage("Item description cannot be empty"),
//     body("items.*.quantity")
//       .optional()
//       .isInt({ min: 1 })
//       .withMessage("Item quantity must be a positive integer"),
//     body("items.*.rate")
//       .optional()
//       .isNumeric()
//       .withMessage("Item rate must be numeric"),
//     body("items.*.amount")
//       .optional()
//       .isNumeric()
//       .withMessage("Item amount must be numeric"),
//     body("notes").optional().isString().withMessage("Notes must be a string"),
//   ],
//   async (req, res) => {
//     try {
//       if (handleValidation(req, res)) return;

//       const { id } = req.params;
//       const updateData = { ...req.body };

//       const access = await ensureCanAccessInvoice(req, res, id);
//       if (!access.ok) return;

//       const [existingInvoices] = await pool.execute(
//         "SELECT id, status, customer_id FROM invoices WHERE id = ?",
//         sanitizeParams(id)
//       );

//       if (existingInvoices.length === 0) {
//         return res.status(404).json({ error: "Invoice not found" });
//       }

//       if (updateData.customerId) {
//         const [customers] = await pool.execute(
//           "SELECT id, assigned_to FROM customers WHERE id = ?",
//           sanitizeParams(updateData.customerId)
//         );

//         if (customers.length === 0) {
//           return res.status(400).json({ error: "Customer not found" });
//         }

//         if (
//           req.user.role !== "admin" &&
//           customers[0].assigned_to !== req.user.userId
//         ) {
//           return res.status(403).json({
//             error: "You do not have permission to set this customer on invoice",
//           });
//         }
//       }

//       // normalize date fields before building query
//       if (updateData.dueDate) {
//         updateData.dueDate = toSqlDate(updateData.dueDate);
//       }
//       if (updateData.paidDate) {
//         updateData.paidDate = toSqlDate(updateData.paidDate);
//       }

//       const connection = await pool.getConnection();
//       await connection.beginTransaction();

//       try {
//         const updateFields = [];
//         const updateValues = [];

//         Object.entries(updateData).forEach(([key, value]) => {
//           if (key === "items" || value === undefined) return;
//           const dbField = invoiceFieldMap[key];
//           if (!dbField) return;

//           updateFields.push(`${dbField} = ?`);
//           updateValues.push(value);
//         });

//         const currentInvoice = existingInvoices[0];
//         if (
//           updateData.status === "paid" &&
//           currentInvoice.status !== "paid" &&
//           !updateData.paidDate
//         ) {
//           updateFields.push("paid_date = CURRENT_DATE");
//         }

//         if (updateFields.length > 0) {
//           updateValues.push(id);
//           await connection.execute(
//             `UPDATE invoices SET ${updateFields.join(
//               ", "
//             )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
//             sanitizeParams(...updateValues)
//           );
//         }

//         if (Array.isArray(updateData.items)) {
//           await connection.execute(
//             "DELETE FROM invoice_items WHERE invoice_id = ?",
//             sanitizeParams(id)
//           );

//           for (const item of updateData.items) {
//             const itemId = uuidv4();
//             await connection.execute(
//               `
//                 INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount)
//                 VALUES (?, ?, ?, ?, ?, ?)
//               `,
//               sanitizeParams(
//                 itemId,
//                 id,
//                 item.description,
//                 item.quantity,
//                 item.rate,
//                 item.amount
//               )
//             );
//           }
//         }

//         await connection.commit();

//         const [invoices] = await connection.execute(
//           `
//             SELECT 
//               i.*,
//               c.name AS customer_name,
//               c.company AS customer_company,
//               c.email AS customer_email
//             FROM invoices i
//             LEFT JOIN customers c ON i.customer_id = c.id
//             WHERE i.id = ?
//           `,
//           sanitizeParams(id)
//         );

//         const [invoiceItems] = await connection.execute(
//           "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
//           sanitizeParams(id)
//         );

//         const invoice = invoices[0];
//         invoice.items = invoiceItems;

//         res.json({
//           message: "Invoice updated successfully",
//           invoice,
//         });
//       } catch (err) {
//         await connection.rollback();
//         throw err;
//       } finally {
//         connection.release();
//       }
//     } catch (error) {
//       console.error("Invoice update error:", error);
//       res.status(500).json({ error: "Failed to update invoice" });
//     }
//   }
// );

// // Delete invoice
// router.delete("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;

//     const access = await ensureCanAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [existingInvoices] = await pool.execute(
//       "SELECT id FROM invoices WHERE id = ?",
//       sanitizeParams(id)
//     );

//     if (existingInvoices.length === 0) {
//       return res.status(404).json({ error: "Invoice not found" });
//     }

//     await pool.execute(
//       "DELETE FROM invoices WHERE id = ?",
//       sanitizeParams(id)
//     );

//     res.json({ message: "Invoice deleted successfully" });
//   } catch (error) {
//     console.error("Invoice deletion error:", error);
//     res.status(500).json({ error: "Failed to delete invoice" });
//   }
// });

// // Get invoice statistics
// router.get("/stats/overview", authenticateToken, async (req, res) => {
//   try {
//     let whereClause = "WHERE 1=1";
//     const params = [];

//     if (req.user.role !== "admin") {
//       whereClause += " AND c.assigned_to = ?";
//       params.push(req.user.userId);
//     }

//     const [stats] = await pool.execute(
//       `
//         SELECT 
//           i.status,
//           COUNT(*) AS count,
//           SUM(i.total) AS total_amount
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//         GROUP BY i.status
//       `,
//       sanitizeParams(...params)
//     );

//     const [monthlyStats] = await pool.execute(
//       `
//         SELECT 
//           DATE_FORMAT(i.created_at, '%Y-%m') AS month,
//           COUNT(*) AS count,
//           SUM(i.total) AS total_amount
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//         AND i.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
//         GROUP BY DATE_FORMAT(i.created_at, '%Y-%m')
//         ORDER BY month
//       `,
//       sanitizeParams(...params)
//     );

//     const [overdueInvoices] = await pool.execute(
//       `
//         SELECT COUNT(*) AS count, SUM(i.total) AS total_amount
//         FROM invoices i
//         LEFT JOIN customers c ON i.customer_id = c.id
//         ${whereClause}
//         AND i.status IN ('sent', 'overdue') AND i.due_date < CURDATE()
//       `,
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


//testing (20-12-2025)

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
//   dueDate: "due_date",
//   paidDate: "paid_date",
//   notes: "notes",
// };

// const buildInvoiceFromCustomer = (customer, body) => {
//   const { amount, tax, total, status, dueDate, notes, items } = body;

//   let derivedAmount = amount;
//   if (derivedAmount === undefined && Array.isArray(items)) {
//     derivedAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
//   }

//   const defaultTaxRate = customer.default_tax_rate ?? 0;
//   const finalAmount = Number(derivedAmount || 0);
//   const finalTax = tax !== undefined ? Number(tax) : defaultTaxRate || 0;
//   const finalTotal = total !== undefined ? Number(total) : finalAmount + (finalAmount * finalTax) / 100;

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

// // Get invoice by ID
// router.get("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const access = await ensureCanAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [invoices] = await pool.execute(
//       `SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email,
//        c.phone AS customer_phone, c.address AS customer_address, c.city AS customer_city,
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
//     invoice.items = items;

//     res.json({ invoice });
//   } catch (error) {
//     console.error("Invoice fetch error:", error);
//     res.status(500).json({ error: "Failed to fetch invoice" });
//   }
// });

// // DOWNLOAD INVOICE PDF WITH PROPER FORMATTING
// router.get("/:id/download", async (req, res) => {
//   try {
//     const { id } = req.params;

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

//     // Calculate amounts
//     const subtotal = Number(invoice.amount || 0);
//     const gstRate = Number(invoice.tax || 18);
//     const gstAmount = (subtotal * gstRate) / 100;
//     const totalWithGst = subtotal + gstAmount;

//     // Format customer details
//     const customerName = invoice.customer_name || "N/A";
//     const customerEmail = invoice.customer_email || "";
//     const customerPhone = invoice.customer_phone || "";
//     const customerCompany = invoice.customer_company || "";
    
//     const addressParts = [
//       invoice.customer_address,
//       invoice.customer_city,
//       invoice.customer_state,
//       invoice.customer_zip_code,
//       invoice.customer_country,
//     ].filter(Boolean);
//     const customerAddress = addressParts.length > 0 ? addressParts.join(", ") : "N/A";

//     const formatPdfDate = (value) => {
//       if (!value) return "N/A";
//       const d = new Date(value);
//       if (Number.isNaN(d.getTime())) return "N/A";
//       return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
//     };

//     const issueDate = formatPdfDate(invoice.issue_date);
//     const dueDate = formatPdfDate(invoice.due_date);

//     // Create PDF
//     const doc = new PDFDocument({ margin: 50, size: 'A4' });

//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
//     doc.pipe(res);

//     // ===== HEADER =====
//     doc.fontSize(26).font('Helvetica-Bold').fillColor('#1E40AF').text("INVOICE", { align: "center" });
//     doc.moveDown(0.3);
//     doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#3B82F6').lineWidth(3).stroke();
//     doc.moveDown(1.5);

//     // ===== CUSTOMER & INVOICE INFO (Two Columns) =====
//     const leftX = 50;
//     const rightX = 320;
//     const startY = doc.y;

//     // LEFT: Customer Details
//     doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text("BILL TO:", leftX, startY);
//     doc.fontSize(10).font('Helvetica');
    
//     let currentY = startY + 20;
//     doc.text(customerName, leftX, currentY, { width: 240 });
//     currentY = doc.y + 3;
    
//     if (customerCompany) {
//       doc.fillColor('#4B5563').text(customerCompany, leftX, currentY, { width: 240 });
//       currentY = doc.y + 3;
//     }
    
//     if (customerEmail) {
//       doc.fillColor('#6B7280').fontSize(9).text(`Email: ${customerEmail}`, leftX, currentY, { width: 240 });
//       currentY = doc.y + 2;
//     }
    
//     if (customerPhone) {
//       doc.fillColor('#6B7280').text(`Phone: ${customerPhone}`, leftX, currentY, { width: 240 });
//       currentY = doc.y + 2;
//     }
    
//     doc.fillColor('#4B5563').fontSize(9).text(customerAddress, leftX, currentY, { width: 240 });
//     const leftEndY = doc.y;

//     // RIGHT: Invoice Details
//     doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000');
//     let rightY = startY;
    
//     doc.text("Invoice Number:", rightX, rightY, { width: 110, continued: false });
//     doc.font('Helvetica').text(invoice.invoice_number || "N/A", rightX + 115, rightY, { width: 115 });
//     rightY += 22;
    
//     doc.font('Helvetica-Bold').text("Issue Date:", rightX, rightY, { width: 110, continued: false });
//     doc.font('Helvetica').text(issueDate, rightX + 115, rightY, { width: 115 });
//     rightY += 22;
    
//     doc.font('Helvetica-Bold').text("Due Date:", rightX, rightY, { width: 110, continued: false });
//     doc.font('Helvetica').text(dueDate, rightX + 115, rightY, { width: 115 });
//     rightY += 22;
    
//     doc.font('Helvetica-Bold').text("Status:", rightX, rightY, { width: 110, continued: false });
//     const statusText = (invoice.status || "draft").toUpperCase();
//     const statusColor = invoice.status === 'paid' ? '#10B981' : invoice.status === 'overdue' ? '#EF4444' : '#6B7280';
//     doc.font('Helvetica-Bold').fillColor(statusColor).text(statusText, rightX + 115, rightY, { width: 115 });
    
//     const rightEndY = rightY + 20;

//     // Move to start table
//     doc.fillColor('#000000');
//     doc.y = Math.max(leftEndY, rightEndY) + 30;

//     // ===== SERVICE TABLE =====
//     const tableTop = doc.y;
//     const colSrX = 50;
//     const colSrW = 50;
//     const colServiceX = 105;
//     const colServiceW = 315;
//     const colChargesX = 425;
//     const colChargesW = 125;
//     const tableWidth = colSrW + colServiceW + colChargesW;

//     // Table Header
//     doc.rect(colSrX, tableTop, tableWidth, 28).fillAndStroke('#E0E7FF', '#C7D2FE');
//     doc.fillColor('#1E40AF').fontSize(11).font('Helvetica-Bold');
//     doc.text("Sr. No", colSrX + 8, tableTop + 9, { width: colSrW - 16 });
//     doc.text("Service / Description", colServiceX + 8, tableTop + 9, { width: colServiceW - 16 });
//     doc.text("Charges (₹)", colChargesX + 8, tableTop + 9, { width: colChargesW - 16, align: 'right' });

//     let rowY = tableTop + 28;

//     // Table Rows
//     doc.fillColor('#000000').fontSize(10).font('Helvetica');
    
//     if (items && items.length > 0) {
//       items.forEach((item, idx) => {
//         const rowHeight = 35;
//         const itemAmount = Number(item.amount || 0);
        
//         // Alternate row colors
//         if (idx % 2 === 0) {
//           doc.rect(colSrX, rowY, tableWidth, rowHeight).fill('#F9FAFB');
//         }
        
//         doc.fillColor('#000000');
//         doc.text((idx + 1).toString(), colSrX + 8, rowY + 12, { width: colSrW - 16, align: 'center' });
//         doc.text(item.description || "Service", colServiceX + 8, rowY + 12, { width: colServiceW - 16 });
//         doc.font('Helvetica-Bold').text(itemAmount.toFixed(2), colChargesX + 8, rowY + 12, { width: colChargesW - 16, align: 'right' });
//         doc.font('Helvetica');
        
//         rowY += rowHeight;
//       });
//     } else {
//       // Single default service
//       doc.text("1", colSrX + 8, rowY + 12, { width: colSrW - 16, align: 'center' });
//       doc.text("Service Charges", colServiceX + 8, rowY + 12, { width: colServiceW - 16 });
//       doc.font('Helvetica-Bold').text(subtotal.toFixed(2), colChargesX + 8, rowY + 12, { width: colChargesW - 16, align: 'right' });
//       doc.font('Helvetica');
//       rowY += 35;
//     }

//     // Table bottom border
//     doc.moveTo(colSrX, rowY).lineTo(colSrX + tableWidth, rowY).strokeColor('#9CA3AF').lineWidth(1).stroke();
//     rowY += 25;

//     // ===== TOTALS SECTION =====
//     const totalsLabelX = 330;
//     const totalsValueX = 470;
//     const totalsW = 80;

//     doc.fontSize(11).font('Helvetica').fillColor('#000000');
//     doc.text("Total amount (before GST):", totalsLabelX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold').text(`₹${subtotal.toFixed(2)}`, totalsValueX, rowY, { width: totalsW, align: 'right' });
//     rowY += 22;

//     doc.font('Helvetica').fillColor('#D97706');
//     doc.text(`GST (${gstRate}%):`, totalsLabelX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold').text(`₹${gstAmount.toFixed(2)}`, totalsValueX, rowY, { width: totalsW, align: 'right' });
//     rowY += 22;

//     // Separator line
//     doc.moveTo(totalsLabelX, rowY).lineTo(totalsValueX + totalsW, rowY).strokeColor('#D1D5DB').lineWidth(1).stroke();
//     rowY += 12;

//     // Grand Total
//     doc.fontSize(13).font('Helvetica-Bold').fillColor('#1E40AF');
//     doc.text("Total Payable (with GST):", totalsLabelX, rowY, { width: 135 });
//     doc.fontSize(14).text(`₹${totalWithGst.toFixed(2)}`, totalsValueX, rowY, { width: totalsW, align: 'right' });
//     rowY += 35;

//     // ===== NOTES =====
//     if (invoice.notes && invoice.notes.trim()) {
//       doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000');
//       doc.text("Notes:", 50, rowY);
//       rowY += 18;
      
//       doc.fontSize(9).font('Helvetica').fillColor('#4B5563');
//       doc.text(invoice.notes.trim(), 50, rowY, { width: 500, align: 'left' });
//       rowY = doc.y + 20;
//     }

//     // ===== FOOTER =====
//     const footerY = 750;
//     doc.fontSize(9).font('Helvetica').fillColor('#9CA3AF');
//     doc.text("Thank you for your business!", 50, footerY, { align: 'center', width: 500 });
//     doc.fontSize(8).text(`Generated on ${new Date().toLocaleDateString('en-IN')}`, 50, footerY + 15, { align: 'center', width: 500 });

//     doc.end();
//   } catch (error) {
//     console.error("Invoice PDF error:", error);
//     if (!res.headersSent) {
//       res.status(500).json({ error: "Failed to generate invoice PDF" });
//     }
//   }
// });

// // Create invoice
// router.post("/", authenticateToken, [
//   body("customerId").notEmpty(),
//   body("items").isArray({ min: 1 }),
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
//       await connection.execute(
//         `INSERT INTO invoices (id, customer_id, invoice_number, amount, tax, total, status, due_date, notes)
//          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//         sanitizeParams(invoiceId, customerId, invoiceNumber, built.amount, built.tax, built.total, built.status, built.dueDate, built.notes)
//       );

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
//     res.status(500).json({ error: "Failed to create invoice" });
//   }
// });

// // Update invoice
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

// // Delete invoice
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

// // Get statistics
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



//testing 2

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

//   // Handle issue date
//   let finalIssueDate;
//   if (issueDate) {
//     finalIssueDate = toSqlDate(issueDate);
//   } else {
//     finalIssueDate = toSqlDate(new Date());
//   }

//   // Handle due date
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

// // Get invoice by ID
// router.get("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const access = await ensureCanAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [invoices] = await pool.execute(
//       `SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email,
//        c.phone AS customer_phone, c.address AS customer_address, c.city AS customer_city,
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
//     invoice.items = items;

//     res.json({ invoice });
//   } catch (error) {
//     console.error("Invoice fetch error:", error);
//     res.status(500).json({ error: "Failed to fetch invoice" });
//   }
// });

// // DOWNLOAD INVOICE PDF WITH PROPER FORMATTING
// router.get("/:id/download", async (req, res) => {
//   try {
//     const { id } = req.params;

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

//     // Calculate amounts
//     const subtotal = Number(invoice.amount || 0);
//     const gstRate = Number(invoice.tax || 18);
//     const gstAmount = (subtotal * gstRate) / 100;
//     const totalWithGst = subtotal + gstAmount;

//     // Format customer details
//     const customerName = invoice.customer_name || "N/A";
//     const customerEmail = invoice.customer_email || "";
//     const customerPhone = invoice.customer_phone || "";
//     const customerCompany = invoice.customer_company || "";
    
//     const addressParts = [
//       invoice.customer_address,
//       invoice.customer_city,
//       invoice.customer_state,
//       invoice.customer_zip_code,
//       invoice.customer_country,
//     ].filter(Boolean);
//     const customerAddress = addressParts.length > 0 ? addressParts.join(", ") : "N/A";

//     const formatPdfDate = (value) => {
//       if (!value) {
//         // If no date, use current date for issue date
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

//     const issueDate = formatPdfDate(invoice.issue_date || invoice.created_at);
//     const dueDate = formatPdfDate(invoice.due_date);

//     // Create PDF
//     const doc = new PDFDocument({ margin: 50, size: 'A4' });

//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
//     doc.pipe(res);

//     // ===== HEADER =====
//     doc.fontSize(26).font('Helvetica-Bold').fillColor('#1E40AF').text("INVOICE", { align: "center" });
//     doc.moveDown(0.3);
//     doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#3B82F6').lineWidth(3).stroke();
//     doc.moveDown(1.5);

//     // ===== CUSTOMER & INVOICE INFO (Two Columns) =====
//     const leftX = 50;
//     const rightX = 320;
//     const startY = doc.y;

//     // LEFT: Customer Details
//     doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text("BILL TO:", leftX, startY);
//     doc.fontSize(10).font('Helvetica');
    
//     let currentY = startY + 20;
//     doc.text(customerName, leftX, currentY, { width: 240 });
//     currentY = doc.y + 3;
    
//     if (customerCompany) {
//       doc.fillColor('#4B5563').text(customerCompany, leftX, currentY, { width: 240 });
//       currentY = doc.y + 3;
//     }
    
//     if (customerEmail) {
//       doc.fillColor('#6B7280').fontSize(9).text(`Email: ${customerEmail}`, leftX, currentY, { width: 240 });
//       currentY = doc.y + 2;
//     }
    
//     if (customerPhone) {
//       doc.fillColor('#6B7280').text(`Phone: ${customerPhone}`, leftX, currentY, { width: 240 });
//       currentY = doc.y + 2;
//     }
    
//     doc.fillColor('#4B5563').fontSize(9).text(customerAddress, leftX, currentY, { width: 240 });
//     const leftEndY = doc.y;

//     // RIGHT: Invoice Details
//     doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000');
//     let rightY = startY;
    
//     doc.text("Invoice Number:", rightX, rightY, { width: 110, continued: false });
//     doc.font('Helvetica').text(invoice.invoice_number || "N/A", rightX + 115, rightY, { width: 115 });
//     rightY += 22;
    
//     doc.font('Helvetica-Bold').text("Issue Date:", rightX, rightY, { width: 110, continued: false });
//     doc.font('Helvetica').text(issueDate, rightX + 115, rightY, { width: 115 });
//     rightY += 22;
    
//     doc.font('Helvetica-Bold').text("Due Date:", rightX, rightY, { width: 110, continued: false });
//     doc.font('Helvetica').text(dueDate, rightX + 115, rightY, { width: 115 });
//     rightY += 22;
    
//     doc.font('Helvetica-Bold').text("Status:", rightX, rightY, { width: 110, continued: false });
//     const statusText = (invoice.status || "draft").toUpperCase();
//     const statusColor = invoice.status === 'paid' ? '#10B981' : invoice.status === 'overdue' ? '#EF4444' : '#6B7280';
//     doc.font('Helvetica-Bold').fillColor(statusColor).text(statusText, rightX + 115, rightY, { width: 115 });
    
//     const rightEndY = rightY + 20;

//     // Move to start table
//     doc.fillColor('#000000');
//     doc.y = Math.max(leftEndY, rightEndY) + 30;

//     // ===== SERVICE TABLE =====
//     const tableTop = doc.y;
//     const colSrX = 50;
//     const colSrW = 50;
//     const colServiceX = 105;
//     const colServiceW = 315;
//     const colChargesX = 425;
//     const colChargesW = 125;
//     const tableWidth = colSrW + colServiceW + colChargesW;

//     // Table Header
//     doc.rect(colSrX, tableTop, tableWidth, 28).fillAndStroke('#E0E7FF', '#C7D2FE');
//     doc.fillColor('#1E40AF').fontSize(11).font('Helvetica-Bold');
//     doc.text("Sr. No", colSrX + 8, tableTop + 9, { width: colSrW - 16 });
//     doc.text("Service / Description", colServiceX + 8, tableTop + 9, { width: colServiceW - 16 });
//     doc.text("Charges (\u20B9)", colChargesX + 8, tableTop + 9, { width: colChargesW - 16, align: 'right' });

//     let rowY = tableTop + 28;

//     // Table Rows
//     doc.fillColor('#000000').fontSize(10).font('Helvetica');
    
//     if (items && items.length > 0) {
//       items.forEach((item, idx) => {
//         const rowHeight = 35;
//         const itemAmount = Number(item.amount || 0);
        
//         // Alternate row colors
//         if (idx % 2 === 0) {
//           doc.rect(colSrX, rowY, tableWidth, rowHeight).fill('#F9FAFB');
//         }
        
//         doc.fillColor('#000000');
//         doc.text((idx + 1).toString(), colSrX + 8, rowY + 12, { width: colSrW - 16, align: 'center' });
//         doc.text(item.description || "Service", colServiceX + 8, rowY + 12, { width: colServiceW - 16 });
//         doc.font('Helvetica-Bold').text(itemAmount.toFixed(2), colChargesX + 8, rowY + 12, { width: colChargesW - 16, align: 'right' });
//         doc.font('Helvetica');
        
//         rowY += rowHeight;
//       });
//     } else {
//       // Single default service
//       doc.text("1", colSrX + 8, rowY + 12, { width: colSrW - 16, align: 'center' });
//       doc.text("Service Charges", colServiceX + 8, rowY + 12, { width: colServiceW - 16 });
//       doc.font('Helvetica-Bold').text(subtotal.toFixed(2), colChargesX + 8, rowY + 12, { width: colChargesW - 16, align: 'right' });
//       doc.font('Helvetica');
//       rowY += 35;
//     }

//     // Table bottom border
//     doc.moveTo(colSrX, rowY).lineTo(colSrX + tableWidth, rowY).strokeColor('#9CA3AF').lineWidth(1).stroke();
//     rowY += 25;

//     // ===== TOTALS SECTION =====
//     const totalsLabelX = 330;
//     const totalsValueX = 470;
//     const totalsW = 80;

//     doc.fontSize(11).font('Helvetica').fillColor('#000000');
//     doc.text("Total amount (before GST):", totalsLabelX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold').text(`\u20B9${subtotal.toFixed(2)}`, totalsValueX, rowY, { width: totalsW, align: 'right' });
//     rowY += 22;

//     doc.font('Helvetica').fillColor('#D97706');
//     doc.text(`GST (${gstRate}%):`, totalsLabelX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold').text(`\u20B9${gstAmount.toFixed(2)}`, totalsValueX, rowY, { width: totalsW, align: 'right' });
//     rowY += 22;

//     // Separator line
//     doc.moveTo(totalsLabelX, rowY).lineTo(totalsValueX + totalsW, rowY).strokeColor('#D1D5DB').lineWidth(1).stroke();
//     rowY += 12;

//     // Grand Total
//     doc.fontSize(13).font('Helvetica-Bold').fillColor('#1E40AF');
//     doc.text("Total Payable (with GST):", totalsLabelX, rowY, { width: 135 });
//     doc.fontSize(14).text(`\u20B9${totalWithGst.toFixed(2)}`, totalsValueX, rowY, { width: totalsW, align: 'right' });
//     rowY += 35;

//     // ===== NOTES =====
//     if (invoice.notes && invoice.notes.trim()) {
//       doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000');
//       doc.text("Notes:", 50, rowY);
//       rowY += 18;
      
//       doc.fontSize(9).font('Helvetica').fillColor('#4B5563');
//       doc.text(invoice.notes.trim(), 50, rowY, { width: 500, align: 'left' });
//       rowY = doc.y + 20;
//     }

//     // ===== FOOTER =====
//     const footerY = 750;
//     doc.fontSize(9).font('Helvetica').fillColor('#9CA3AF');
//     doc.text("Thank you for your business!", 50, footerY, { align: 'center', width: 500 });
//     doc.fontSize(8).text(`Generated on ${new Date().toLocaleDateString('en-IN')}`, 50, footerY + 15, { align: 'center', width: 500 });

//     doc.end();
//   } catch (error) {
//     console.error("Invoice PDF error:", error);
//     if (!res.headersSent) {
//       res.status(500).json({ error: "Failed to generate invoice PDF" });
//     }
//   }
// });

// // Create invoice
// router.post("/", authenticateToken, [
//   body("customerId").notEmpty().withMessage("Customer ID is required"),
//   body("items").isArray({ min: 1 }).withMessage("Items array required"),
//   body("amount").optional().isNumeric(),
//   body("tax").optional().isNumeric(),
//   body("total").optional().isNumeric(),
//   body("issueDate").optional().isISO8601(),
//   body("dueDate").optional().isISO8601(),
// ], async (req, res) => {
//   try {
//     if (handleValidation(req, res)) return;

//     const { customerId, items } = req.body;
    
//     console.log("Creating invoice for customer:", customerId);
//     console.log("Request body:", JSON.stringify(req.body, null, 2));

//     const [customers] = await pool.execute(
//       `SELECT id, assigned_to, default_tax_rate, default_due_days, default_invoice_notes FROM customers WHERE id = ?`,
//       sanitizeParams(customerId)
//     );

//     if (customers.length === 0) {
//       console.error("Customer not found:", customerId);
//       return res.status(400).json({ error: "Customer not found" });
//     }

//     const customer = customers[0];
//     console.log("Found customer:", customer);

//     if (req.user.role !== "admin" && customer.assigned_to !== req.user.userId) {
//       return res.status(403).json({ error: "You do not have permission to invoice this customer" });
//     }

//     const built = buildInvoiceFromCustomer(customer, req.body);
//     console.log("Built invoice data:", built);

//     const invoiceNumber = generateInvoiceNumber();
//     const invoiceId = uuidv4();

//     console.log("Invoice ID:", invoiceId);
//     console.log("Invoice Number:", invoiceNumber);

//     const connection = await pool.getConnection();
//     await connection.beginTransaction();

//     try {
//       console.log("Inserting invoice into database...");
      
//       // Try to insert with issue_date first
//       try {
//         await connection.execute(
//           `INSERT INTO invoices (id, customer_id, invoice_number, amount, tax, total, status, issue_date, due_date, notes)
//            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(
//             invoiceId, 
//             customerId, 
//             invoiceNumber, 
//             built.amount, 
//             built.tax, 
//             built.total, 
//             built.status, 
//             built.issueDate, 
//             built.dueDate, 
//             built.notes
//           )
//         );
//       } catch (insertError) {
//         console.error("Error inserting with issue_date, trying without:", insertError);
        
//         // If issue_date column doesn't exist, try without it
//         await connection.execute(
//           `INSERT INTO invoices (id, customer_id, invoice_number, amount, tax, total, status, due_date, notes)
//            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(
//             invoiceId, 
//             customerId, 
//             invoiceNumber, 
//             built.amount, 
//             built.tax, 
//             built.total, 
//             built.status, 
//             built.dueDate, 
//             built.notes
//           )
//         );
//       }

//       console.log("Invoice inserted successfully");
//       console.log("Inserting items...");

//       for (const item of items) {
//         const itemId = uuidv4();
//         console.log("Inserting item:", item);
        
//         await connection.execute(
//           `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(itemId, invoiceId, item.description, item.quantity, item.rate, item.amount)
//         );
//       }

//       console.log("All items inserted, committing transaction...");
//       await connection.commit();

//       console.log("Fetching created invoice...");
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

//       console.log("Invoice created successfully:", invoice);

//       res.status(201).json({ message: "Invoice created successfully", invoice });
//     } catch (err) {
//       console.error("Error during invoice creation, rolling back:", err);
//       await connection.rollback();
//       throw err;
//     } finally {
//       connection.release();
//     }
//   } catch (error) {
//     console.error("Invoice creation error:", error);
//     console.error("Error stack:", error.stack);
//     res.status(500).json({ 
//       error: "Failed to create invoice",
//       details: error.message,
//       stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
//     });
//   }
// });

// // Update invoice
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

// // Delete invoice
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

// // Get invoice statistics
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

// // DIAGNOSTIC ENDPOINT - Check database schema
// router.get("/debug/schema", authenticateToken, async (req, res) => {
//   try {
//     if (req.user.role !== "admin") {
//       return res.status(403).json({ error: "Admin only" });
//     }

//     const [columns] = await pool.execute(
//       `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
//        FROM INFORMATION_SCHEMA.COLUMNS
//        WHERE TABLE_NAME = 'invoices' AND TABLE_SCHEMA = DATABASE()
//        ORDER BY ORDINAL_POSITION`
//     );

//     const [sampleInvoice] = await pool.execute(
//       `SELECT * FROM invoices ORDER BY created_at DESC LIMIT 1`
//     );

//     res.json({
//       message: "Invoice table schema",
//       columns: columns,
//       sampleData: sampleInvoice[0] || null,
//       hasIssueDate: columns.some(col => col.COLUMN_NAME === 'issue_date')
//     });
//   } catch (error) {
//     console.error("Schema check error:", error);
//     res.status(500).json({ error: "Failed to check schema", details: error.message });
//   }
// });

// module.exports = router;

//testing 3 (Above code workign only small issue)

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

//   // Handle issue date
//   let finalIssueDate;
//   if (issueDate) {
//     finalIssueDate = toSqlDate(issueDate);
//   } else {
//     finalIssueDate = toSqlDate(new Date());
//   }

//   // Handle due date
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

// // Get invoice by ID
// router.get("/:id", authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const access = await ensureCanAccessInvoice(req, res, id);
//     if (!access.ok) return;

//     const [invoices] = await pool.execute(
//       `SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email,
//        c.phone AS customer_phone, c.address AS customer_address, c.city AS customer_city,
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
//     invoice.items = items;

//     res.json({ invoice });
//   } catch (error) {
//     console.error("Invoice fetch error:", error);
//     res.status(500).json({ error: "Failed to fetch invoice" });
//   }
// });

// // DOWNLOAD INVOICE PDF WITH PROPER FORMATTING
// router.get("/:id/download", async (req, res) => {
//   try {
//     const { id } = req.params;

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

//     // Calculate amounts
//     const subtotal = Number(invoice.amount || 0);
//     const gstRate = Number(invoice.tax || 18);
//     const gstAmount = (subtotal * gstRate) / 100;
//     const totalWithGst = subtotal + gstAmount;

//     // Format customer details
//     const customerName = invoice.customer_name || "N/A";
//     const customerEmail = invoice.customer_email || "";
//     const customerPhone = invoice.customer_phone || "";
//     const customerCompany = invoice.customer_company || "";
    
//     const addressParts = [
//       invoice.customer_address,
//       invoice.customer_city,
//       invoice.customer_state,
//       invoice.customer_zip_code,
//       invoice.customer_country,
//     ].filter(Boolean);
//     const customerAddress = addressParts.length > 0 ? addressParts.join(", ") : "N/A";

//     const formatPdfDate = (value) => {
//       if (!value) {
//         // If no date, use current date for issue date
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

//     const issueDate = formatPdfDate(invoice.issue_date || invoice.created_at);
//     const dueDate = formatPdfDate(invoice.due_date);

//     // Create PDF
//     const doc = new PDFDocument({ margin: 50, size: 'A4' });

//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
//     doc.pipe(res);

//     // ===== HEADER =====
//     doc.fontSize(26).font('Helvetica-Bold').fillColor('#1E40AF').text("INVOICE", { align: "center" });
//     doc.moveDown(0.3);
//     doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#3B82F6').lineWidth(3).stroke();
//     doc.moveDown(1.5);

//     // ===== CUSTOMER & INVOICE INFO (Two Columns) =====
//     const leftX = 50;
//     const rightX = 320;
//     const startY = doc.y;

//     // LEFT: Customer Details
//     doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text("BILL TO:", leftX, startY);
//     doc.fontSize(10).font('Helvetica');
    
//     let currentY = startY + 20;
//     doc.text(customerName, leftX, currentY, { width: 240 });
//     currentY = doc.y + 3;
    
//     if (customerCompany) {
//       doc.fillColor('#4B5563').text(customerCompany, leftX, currentY, { width: 240 });
//       currentY = doc.y + 3;
//     }
    
//     if (customerEmail) {
//       doc.fillColor('#6B7280').fontSize(9).text(`Email: ${customerEmail}`, leftX, currentY, { width: 240 });
//       currentY = doc.y + 2;
//     }
    
//     if (customerPhone) {
//       doc.fillColor('#6B7280').text(`Phone: ${customerPhone}`, leftX, currentY, { width: 240 });
//       currentY = doc.y + 2;
//     }
    
//     doc.fillColor('#4B5563').fontSize(9).text(customerAddress, leftX, currentY, { width: 240 });
//     const leftEndY = doc.y;

//     // RIGHT: Invoice Details
//     doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000');
//     let rightY = startY;
    
//     doc.text("Invoice Number:", rightX, rightY, { width: 110, continued: false });
//     doc.font('Helvetica').text(invoice.invoice_number || "N/A", rightX + 115, rightY, { width: 115 });
//     rightY += 22;
    
//     doc.font('Helvetica-Bold').text("Issue Date:", rightX, rightY, { width: 110, continued: false });
//     doc.font('Helvetica').text(issueDate, rightX + 115, rightY, { width: 115 });
//     rightY += 22;
    
//     doc.font('Helvetica-Bold').text("Due Date:", rightX, rightY, { width: 110, continued: false });
//     doc.font('Helvetica').text(dueDate, rightX + 115, rightY, { width: 115 });
//     rightY += 22;
    
//     doc.font('Helvetica-Bold').text("Status:", rightX, rightY, { width: 110, continued: false });
//     const statusText = (invoice.status || "draft").toUpperCase();
//     const statusColor = invoice.status === 'paid' ? '#10B981' : invoice.status === 'overdue' ? '#EF4444' : '#6B7280';
//     doc.font('Helvetica-Bold').fillColor(statusColor).text(statusText, rightX + 115, rightY, { width: 115 });
    
//     const rightEndY = rightY + 20;

//     // Move to start table
//     doc.fillColor('#000000');
//     doc.y = Math.max(leftEndY, rightEndY) + 30;

//     // ===== SERVICE TABLE =====
//     const tableTop = doc.y;
//     const colSrX = 50;
//     const colSrW = 50;
//     const colServiceX = 105;
//     const colServiceW = 315;
//     const colChargesX = 425;
//     const colChargesW = 125;
//     const tableWidth = colSrW + colServiceW + colChargesW;

//     // Table Header
//     doc.rect(colSrX, tableTop, tableWidth, 28).fillAndStroke('#E0E7FF', '#C7D2FE');
//     doc.fillColor('#1E40AF').fontSize(11).font('Helvetica-Bold');
//     doc.text("Sr. No", colSrX + 8, tableTop + 9, { width: colSrW - 16 });
//     doc.text("Service / Description", colServiceX + 8, tableTop + 9, { width: colServiceW - 16 });
//     doc.text("Charges (\u20B9)", colChargesX + 8, tableTop + 9, { width: colChargesW - 16, align: 'right' });

//     let rowY = tableTop + 28;

//     // Table Rows
//     doc.fillColor('#000000').fontSize(10).font('Helvetica');
    
//     if (items && items.length > 0) {
//       items.forEach((item, idx) => {
//         const rowHeight = 35;
//         const itemAmount = Number(item.amount || 0);
        
//         // Alternate row colors
//         if (idx % 2 === 0) {
//           doc.rect(colSrX, rowY, tableWidth, rowHeight).fill('#F9FAFB');
//         }
        
//         doc.fillColor('#000000');
//         doc.text((idx + 1).toString(), colSrX + 8, rowY + 12, { width: colSrW - 16, align: 'center' });
//         doc.text(item.description || "Service", colServiceX + 8, rowY + 12, { width: colServiceW - 16 });
//         doc.font('Helvetica-Bold').text(itemAmount.toFixed(2), colChargesX + 8, rowY + 12, { width: colChargesW - 16, align: 'right' });
//         doc.font('Helvetica');
        
//         rowY += rowHeight;
//       });
//     } else {
//       // Single default service
//       doc.text("1", colSrX + 8, rowY + 12, { width: colSrW - 16, align: 'center' });
//       doc.text("Service Charges", colServiceX + 8, rowY + 12, { width: colServiceW - 16 });
//       doc.font('Helvetica-Bold').text(subtotal.toFixed(2), colChargesX + 8, rowY + 12, { width: colChargesW - 16, align: 'right' });
//       doc.font('Helvetica');
//       rowY += 35;
//     }

//     // Table bottom border
//     doc.moveTo(colSrX, rowY).lineTo(colSrX + tableWidth, rowY).strokeColor('#9CA3AF').lineWidth(1).stroke();
//     rowY += 25;

//     // ===== TOTALS SECTION =====
//     const totalsLabelX = 330;
//     const totalsValueX = 470;
//     const totalsW = 80;

//     doc.fontSize(11).font('Helvetica').fillColor('#000000');
//     doc.text("Total amount (before GST):", totalsLabelX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold').text(`\u20B9${subtotal.toFixed(2)}`, totalsValueX, rowY, { width: totalsW, align: 'right' });
//     rowY += 22;

//     doc.font('Helvetica').fillColor('#D97706');
//     doc.text(`GST (${gstRate}%):`, totalsLabelX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold').text(`\u20B9${gstAmount.toFixed(2)}`, totalsValueX, rowY, { width: totalsW, align: 'right' });
//     rowY += 22;

//     // Separator line
//     doc.moveTo(totalsLabelX, rowY).lineTo(totalsValueX + totalsW, rowY).strokeColor('#D1D5DB').lineWidth(1).stroke();
//     rowY += 12;

//     // Grand Total
//     doc.fontSize(13).font('Helvetica-Bold').fillColor('#1E40AF');
//     doc.text("Total Payable (with GST):", totalsLabelX, rowY, { width: 135 });
//     doc.fontSize(14).text(`\u20B9${totalWithGst.toFixed(2)}`, totalsValueX, rowY, { width: totalsW, align: 'right' });
//     rowY += 35;

//     // ===== NOTES =====
//     if (invoice.notes && invoice.notes.trim()) {
//       doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000');
//       doc.text("Notes:", 50, rowY);
//       rowY += 18;
      
//       doc.fontSize(9).font('Helvetica').fillColor('#4B5563');
//       doc.text(invoice.notes.trim(), 50, rowY, { width: 500, align: 'left' });
//       rowY = doc.y + 20;
//     }

//     // ===== FOOTER =====
//     const footerY = 750;
//     doc.fontSize(9).font('Helvetica').fillColor('#9CA3AF');
//     doc.text("Thank you for your business!", 50, footerY, { align: 'center', width: 500 });
//     doc.fontSize(8).text(`Generated on ${new Date().toLocaleDateString('en-IN')}`, 50, footerY + 15, { align: 'center', width: 500 });

//     doc.end();
//   } catch (error) {
//     console.error("Invoice PDF error:", error);
//     if (!res.headersSent) {
//       res.status(500).json({ error: "Failed to generate invoice PDF" });
//     }
//   }
// });

// // Create invoice
// router.post("/", authenticateToken, [
//   body("customerId").notEmpty().withMessage("Customer ID is required"),
//   body("items").isArray({ min: 1 }).withMessage("Items array required"),
//   body("amount").optional().isNumeric(),
//   body("tax").optional().isNumeric(),
//   body("total").optional().isNumeric(),
//   body("issueDate").optional().isISO8601(),
//   body("dueDate").optional().isISO8601(),
// ], async (req, res) => {
//   try {
//     if (handleValidation(req, res)) return;

//     const { customerId, items } = req.body;
    
//     console.log("Creating invoice for customer:", customerId);
//     console.log("Request body:", JSON.stringify(req.body, null, 2));

//     const [customers] = await pool.execute(
//       `SELECT id, assigned_to, default_tax_rate, default_due_days, default_invoice_notes FROM customers WHERE id = ?`,
//       sanitizeParams(customerId)
//     );

//     if (customers.length === 0) {
//       console.error("Customer not found:", customerId);
//       return res.status(400).json({ error: "Customer not found" });
//     }

//     const customer = customers[0];
//     console.log("Found customer:", customer);

//     if (req.user.role !== "admin" && customer.assigned_to !== req.user.userId) {
//       return res.status(403).json({ error: "You do not have permission to invoice this customer" });
//     }

//     const built = buildInvoiceFromCustomer(customer, req.body);
//     console.log("Built invoice data:", built);

//     const invoiceNumber = generateInvoiceNumber();
//     const invoiceId = uuidv4();

//     console.log("Invoice ID:", invoiceId);
//     console.log("Invoice Number:", invoiceNumber);

//     const connection = await pool.getConnection();
//     await connection.beginTransaction();

//     try {
//       console.log("Inserting invoice into database...");
      
//       // Try to insert with issue_date first
//       try {
//         await connection.execute(
//           `INSERT INTO invoices (id, customer_id, invoice_number, amount, tax, total, status, issue_date, due_date, notes)
//            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(
//             invoiceId, 
//             customerId, 
//             invoiceNumber, 
//             built.amount, 
//             built.tax, 
//             built.total, 
//             built.status, 
//             built.issueDate, 
//             built.dueDate, 
//             built.notes
//           )
//         );
//       } catch (insertError) {
//         console.error("Error inserting with issue_date, trying without:", insertError);
        
//         // If issue_date column doesn't exist, try without it
//         await connection.execute(
//           `INSERT INTO invoices (id, customer_id, invoice_number, amount, tax, total, status, due_date, notes)
//            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(
//             invoiceId, 
//             customerId, 
//             invoiceNumber, 
//             built.amount, 
//             built.tax, 
//             built.total, 
//             built.status, 
//             built.dueDate, 
//             built.notes
//           )
//         );
//       }

//       console.log("Invoice inserted successfully");
//       console.log("Inserting items...");

//       for (const item of items) {
//         const itemId = uuidv4();
//         console.log("Inserting item:", item);
        
//         await connection.execute(
//           `INSERT INTO invoice_items (id, invoice_id, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)`,
//           sanitizeParams(itemId, invoiceId, item.description, item.quantity, item.rate, item.amount)
//         );
//       }

//       console.log("All items inserted, committing transaction...");
//       await connection.commit();

//       console.log("Fetching created invoice...");
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

//       console.log("Invoice created successfully:", invoice);

//       res.status(201).json({ message: "Invoice created successfully", invoice });
//     } catch (err) {
//       console.error("Error during invoice creation, rolling back:", err);
//       await connection.rollback();
//       throw err;
//     } finally {
//       connection.release();
//     }
//   } catch (error) {
//     console.error("Invoice creation error:", error);
//     console.error("Error stack:", error.stack);
//     res.status(500).json({ 
//       error: "Failed to create invoice",
//       details: error.message,
//       stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
//     });
//   }
// });

// // Update invoice
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

// // Delete invoice
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

// // Get invoice statistics
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

// // DIAGNOSTIC ENDPOINT - Check database schema
// router.get("/debug/schema", authenticateToken, async (req, res) => {
//   try {
//     if (req.user.role !== "admin") {
//       return res.status(403).json({ error: "Admin only" });
//     }

//     const [columns] = await pool.execute(
//       `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
//        FROM INFORMATION_SCHEMA.COLUMNS
//        WHERE TABLE_NAME = 'invoices' AND TABLE_SCHEMA = DATABASE()
//        ORDER BY ORDINAL_POSITION`
//     );

//     const [sampleInvoice] = await pool.execute(
//       `SELECT * FROM invoices ORDER BY created_at DESC LIMIT 1`
//     );

//     res.json({
//       message: "Invoice table schema",
//       columns: columns,
//       sampleData: sampleInvoice[0] || null,
//       hasIssueDate: columns.some(col => col.COLUMN_NAME === 'issue_date')
//     });
//   } catch (error) {
//     console.error("Schema check error:", error);
//     res.status(500).json({ error: "Failed to check schema", details: error.message });
//   }
// });

// module.exports = router;



//testing 4 for proper allignment of pdf

const { v4: uuidv4 } = require("uuid");
const PDFDocument = require("pdfkit");
const express = require("express");
const { body, validationResult, query } = require("express-validator");
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

  let finalIssueDate;
  if (issueDate) {
    finalIssueDate = toSqlDate(issueDate);
  } else {
    finalIssueDate = toSqlDate(new Date());
  }

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

// Get all invoices
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

//pdf testing
router.post("/:id/download", async (req, res) => {
  try {
    const { id } = req.params;
    const { logoBase64 } = req.body;

    // Fetch invoice data
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
      if (Number.isNaN(d.getTime())) {
        const now = new Date();
        return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
      }
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    };

    // FIX: Helper function to format currency properly
    const formatCurrency = (amount) => {
      return `Rs. ${Number(amount).toFixed(2)}`;
    };

    // Create PDF with proper margins - A4 size is 595.28 x 841.89 points
    const doc = new PDFDocument({ 
      size: 'A4', 
      margin: 40,
      bufferPages: true 
    });
    
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
    doc.pipe(res);

    // PROFESSIONAL COLOR PALETTE
    const brandPrimary = '#1E3A8A';
    const brandSecondary = '#3B82F6';
    const accentGold = '#F59E0B';
    const textDark = '#1F2937';
    const textGray = '#6B7280';
    const bgLight = '#F9FAFB';
    const borderGray = '#E5E7EB';

    // Page dimensions (A4 with 40pt margins)
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const marginLeft = 40;
    const marginRight = 40;
    const contentWidth = pageWidth - marginLeft - marginRight; // 515.28
    
    let currentY = 40;

    // ============ LOGO SECTION ============
    if (logoBase64) {
      try {
        let imageData = logoBase64;
        if (logoBase64.includes(',')) {
          imageData = logoBase64.split(',')[1];
        }
        
        const logoBuffer = Buffer.from(imageData, 'base64');
        
        doc.image(logoBuffer, marginLeft, currentY, { 
          width: 120,
          height: 45,
          fit: [120, 45],
          align: 'left'
        });
        
        currentY += 55;
      } catch (logoError) {
        console.error("Error adding logo:", logoError);
        currentY += 15;
      }
    } else {
      currentY += 15;
    }

    // ============ COMPANY ADDRESS BELOW LOGO ============
    const companyAddress = 'Dani Sanjay Apartment, 102, near Datta Mandir Road, beside Dutta mandir, Kandivali, Veena Sitar, Dahanukar Wadi, Kandivali West, Mumbai, Maharashtra 400067';
    
    doc.fontSize(8)
       .font('Helvetica')
       .fillColor(textGray)
       .text(companyAddress, marginLeft, currentY, { 
         width: 350,
         lineGap: 2,
         align: 'left'
       });
    
    const addressHeight = doc.heightOfString(companyAddress, { width: 350, lineGap: 2 });
    currentY += addressHeight + 15;

    // ============ INVOICE TITLE & LINE ============
    doc.fontSize(26)
       .font('Helvetica-Bold')
       .fillColor(brandPrimary)
       .text('INVOICE', marginLeft, currentY, { 
         align: 'center', 
         width: contentWidth 
       });
    
    currentY += 32;
    
    doc.moveTo(marginLeft, currentY)
       .lineTo(pageWidth - marginRight, currentY)
       .strokeColor(brandSecondary)
       .lineWidth(2.5)
       .stroke();
    
    currentY += 20;

    // ============ TWO-COLUMN LAYOUT: BILL TO & INVOICE DETAILS ============
    const leftColX = marginLeft;
    const leftColWidth = 260;
    const rightColX = marginLeft + leftColWidth + 20;
    const rightColWidth = contentWidth - leftColWidth - 20;
    const startY = currentY;
    
    // LEFT COLUMN - BILL TO
    doc.fontSize(9)
       .font('Helvetica-Bold')
       .fillColor(brandPrimary)
       .text('BILL TO:', leftColX, startY);
    
    let leftY = startY + 16;
    
    // Customer name
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .fillColor(textDark)
       .text(invoice.customer_name || 'Customer Name', leftColX, leftY, { 
         width: leftColWidth,
         lineGap: 1
       });
    leftY += 16;
    
    // Company name
    if (invoice.customer_company) {
      doc.fontSize(10)
         .font('Helvetica')
         .fillColor(textGray)
         .text(invoice.customer_company, leftColX, leftY, { 
           width: leftColWidth,
           lineGap: 1
         });
      leftY += 14;
    }
    
    // Email
    if (invoice.customer_email) {
      doc.fontSize(8.5)
         .font('Helvetica')
         .fillColor(textGray)
         .text(`Email: ${invoice.customer_email}`, leftColX, leftY, { 
           width: leftColWidth,
           lineGap: 1
         });
      leftY += 12;
    }
    
    // Phone
    if (invoice.customer_phone) {
      doc.fontSize(8.5)
         .text(`Phone: ${invoice.customer_phone}`, leftColX, leftY, { 
           width: leftColWidth,
           lineGap: 1
         });
      leftY += 12;
    }
    
    // Address - PROPERLY FORMATTED WITH WRAPPING
    const addressParts = [
      invoice.customer_address,
      invoice.customer_city,
      invoice.customer_state,
      invoice.customer_zip_code,
      invoice.customer_country
    ].filter(Boolean);
    
    if (addressParts.length > 0) {
      const fullAddress = addressParts.join(', ');
      doc.fontSize(8.5)
         .font('Helvetica')
         .fillColor(textGray)
         .text(fullAddress, leftColX, leftY, { 
           width: leftColWidth,
           lineGap: 2,
           align: 'left'
         });
      const addressHeight = doc.heightOfString(fullAddress, { width: leftColWidth, lineGap: 2 });
      leftY += addressHeight + 6;
    }
    
    // RIGHT COLUMN - INVOICE DETAILS (FIX: Better spacing and layout)
    let rightY = startY;
    
    // Invoice Number
    doc.fontSize(9)
       .font('Helvetica-Bold')
       .fillColor(textDark)
       .text('Invoice :', rightColX, rightY);
    rightY += 12;
    doc.fontSize(9)
       .font('Helvetica')
       .fillColor(brandPrimary)
       .text(invoice.invoice_number || 'N/A', rightColX, rightY);
    rightY += 18;
    
    // Issue Date
    doc.fontSize(9)
       .font('Helvetica-Bold')
       .fillColor(textDark)
       .text('Issue Date:', rightColX, rightY);
    rightY += 12;
    doc.fontSize(9)
       .font('Helvetica')
       .fillColor(textGray)
       .text(formatDate(invoice.issue_date || invoice.created_at), rightColX, rightY);
    rightY += 18;
    
    // Due Date
    doc.fontSize(9)
       .font('Helvetica-Bold')
       .fillColor(textDark)
       .text('Due Date:', rightColX, rightY);
    rightY += 12;
    doc.fontSize(9)
       .font('Helvetica')
       .fillColor(textGray)
       .text(formatDate(invoice.due_date), rightColX, rightY);
    rightY += 18;
    
    // Status
    const statusColors = {
      'paid': '#10B981',
      'pending': '#F59E0B',
      'overdue': '#EF4444',
      'draft': '#6B7280',
      'sent': '#3B82F6'
    };
    const statusColor = statusColors[invoice.status] || textGray;
    
    doc.fontSize(9)
       .font('Helvetica-Bold')
       .fillColor(textDark)
       .text('Status:', rightColX, rightY);
    rightY += 12;
    doc.fontSize(9)
       .font('Helvetica-Bold')
       .fillColor(statusColor)
       .text((invoice.status || 'DRAFT').toUpperCase(), rightColX, rightY);
    rightY += 10;
    
    currentY = Math.max(leftY, rightY) + 20;
    
    // ============ ITEMS TABLE ============
    const tableTop = currentY;
    const tableLeft = marginLeft;
    const tableWidth = contentWidth;
    
    // FIX: YELLOW - Increased column widths to prevent overlapping
    const colSrWidth = 35;
    const colAmountWidth = 110; // Increased from 100 to 110
    const colDescWidth = tableWidth - colSrWidth - colAmountWidth;
    
    const colSrX = tableLeft;
    const colDescX = tableLeft + colSrWidth;
    const colAmountX = tableLeft + colSrWidth + colDescWidth;
    
    // Table Header
    doc.rect(tableLeft, tableTop, tableWidth, 30) // Increased height from 28 to 30
       .fillAndStroke(bgLight, borderGray);
    
    doc.fontSize(9)
       .font('Helvetica-Bold')
       .fillColor(brandPrimary);
    
    // Header: Sr. No
    doc.text('Sr.', colSrX + 4, tableTop + 10, { 
      width: colSrWidth - 8, 
      align: 'center' 
    });
    
    // Header: Description
    doc.text('Service / Description', colDescX + 8, tableTop + 10, { 
      width: colDescWidth - 16,
      align: 'left'
    });
    
    // FIX: YELLOW & BLUE - Changed to "Amount (Rs.)" and increased padding
    doc.text('Amount (Rs.)', colAmountX + 10, tableTop + 10, { 
      width: colAmountWidth - 20, // More padding on both sides
      align: 'right' 
    });
    
    let rowY = tableTop + 30;
    
    // Table Rows
    doc.fontSize(9)
       .font('Helvetica')
       .fillColor(textDark);
    
    if (items && items.length > 0) {
      items.forEach((item, idx) => {
        const rowHeight = 30; // Increased from 28 to 30
        
        // Alternate row background
        if (idx % 2 === 1) {
          doc.rect(tableLeft, rowY, tableWidth, rowHeight)
             .fill('#FAFAFA');
        }
        
        doc.fillColor(textDark);
        
        // Serial number
        doc.fontSize(9)
           .font('Helvetica')
           .text((idx + 1).toString(), colSrX + 4, rowY + 10, { 
             width: colSrWidth - 8, 
             align: 'center' 
           });
        
        // Description
        doc.text(item.description || 'Service', colDescX + 8, rowY + 10, { 
          width: colDescWidth - 16,
          align: 'left'
        });
        
        // FIX: YELLOW & BLUE - Amount with proper formatting and spacing
        doc.font('Helvetica-Bold')
           .text(Number(item.amount || 0).toFixed(2), colAmountX + 10, rowY + 10, { 
             width: colAmountWidth - 20, // More padding
             align: 'right' 
           });
        
        doc.font('Helvetica');
        rowY += rowHeight;
      });
    } else {
      // Default row
      doc.fontSize(9)
         .font('Helvetica')
         .text('1', colSrX + 4, rowY + 10, { 
           width: colSrWidth - 8, 
           align: 'center' 
         });
      doc.text('Service Charges', colDescX + 8, rowY + 10, { 
        width: colDescWidth - 16 
      });
      doc.font('Helvetica-Bold')
         .text(subtotal.toFixed(2), colAmountX + 10, rowY + 10, { 
           width: colAmountWidth - 20, 
           align: 'right' 
         });
      doc.font('Helvetica');
      rowY += 30;
    }
    
    // Table bottom border
    doc.moveTo(tableLeft, rowY)
       .lineTo(tableLeft + tableWidth, rowY)
       .strokeColor(borderGray)
       .lineWidth(1)
       .stroke();
    
    rowY += 20;
    
    // ============ TOTALS SECTION ============
    const totalsStartX = pageWidth - marginRight - 240; // Increased from 220
    const labelX = totalsStartX;
    const valueX = pageWidth - marginRight - 90; // Adjusted for more space
    const valueWidth = 80; // Increased from 70
    
    // FIX: BLUE - Using "Rs." instead of ₹ symbol
    // Subtotal
    doc.fontSize(10)
       .font('Helvetica')
       .fillColor(textDark)
       .text('Subtotal:', labelX, rowY, { width: 145, align: 'left' });
    doc.font('Helvetica-Bold')
       .text(formatCurrency(subtotal), valueX, rowY, { 
         width: valueWidth, 
         align: 'right' 
       });
    rowY += 16;
    
    // GST
    doc.font('Helvetica')
       .fillColor(accentGold)
       .text(`GST (${gstRate}%):`, labelX, rowY, { width: 145, align: 'left' });
    doc.font('Helvetica-Bold')
       .fillColor(accentGold)
       .text(formatCurrency(gstAmount), valueX, rowY, { 
         width: valueWidth, 
         align: 'right' 
       });
    rowY += 16;
    
    // Divider line
    doc.moveTo(labelX, rowY)
       .lineTo(pageWidth - marginRight, rowY)
       .strokeColor(borderGray)
       .lineWidth(1)
       .stroke();
    rowY += 10;
    
    // FIX: YELLOW & BLUE - Total with more space and proper formatting
    const boxHeight = 35; // Reduced from 38
    const boxWidth = 245;
    doc.rect(labelX - 5, rowY - 5, boxWidth, boxHeight)
       .fillAndStroke('#EEF2FF', brandSecondary);
    
    doc.fontSize(11)
       .font('Helvetica-Bold')
       .fillColor(brandPrimary)
       .text('Total Payable:', labelX, rowY + 10, { width: 140, align: 'left' });
    
    doc.fontSize(13)
       .font('Helvetica-Bold')
       .fillColor(brandPrimary)
       .text(formatCurrency(totalWithGst), valueX - 5, rowY + 9, { 
         width: valueWidth + 5, 
         align: 'right' 
       });
    
    rowY += boxHeight + 15;
    
    // ============ NOTES SECTION ============
    if (invoice.notes && invoice.notes.trim()) {
      // Only add notes if there's enough space on the page
      if (rowY < pageHeight - 150) {
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor(textDark)
           .text('Notes:', marginLeft, rowY);
        rowY += 14;
        
        doc.fontSize(9)
           .font('Helvetica')
           .fillColor(textGray)
           .text(invoice.notes.trim(), marginLeft, rowY, { 
             width: contentWidth,
             align: 'left',
             lineGap: 2
           });
      }
    }
    
    // ============ FOOTER ============
    const footerY = pageHeight - 60;
    
    doc.fontSize(9)
       .font('Helvetica')
       .fillColor(textGray)
       .text('Thank you for your business!', marginLeft, footerY, { 
         align: 'center', 
         width: contentWidth 
       });
    
    doc.fontSize(7.5)
       .fillColor('#9CA3AF')
       .text(`Generated on ${new Date().toLocaleDateString('en-IN', {
         day: '2-digit',
         month: '2-digit',
         year: 'numeric'
       })}`, marginLeft, footerY + 14, { 
         align: 'center', 
         width: contentWidth 
       });

    doc.end();
  } catch (error) {
    console.error("Invoice PDF generation error:", error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Failed to generate invoice PDF", 
        details: error.message 
      });
    }
  }
});

// PREMIUM PROFESSIONAL INVOICE PDF WITH LOGO
// Replace your existing download route with this complete implementation

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

//     // Create PDF with proper margins
//     const doc = new PDFDocument({ 
//       size: 'A4', 
//       margin: 50,
//       bufferPages: true 
//     });
    
//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
//     doc.pipe(res);

//     // PROFESSIONAL COLOR PALETTE
//     const brandPrimary = '#1E3A8A';  // Deep Blue
//     const brandSecondary = '#3B82F6'; // Bright Blue
//     const accentGold = '#F59E0B';     // Gold
//     const textDark = '#1F2937';       // Almost Black
//     const textGray = '#6B7280';       // Gray
//     const bgLight = '#F9FAFB';        // Light Gray
//     const borderGray = '#E5E7EB';     // Border Gray

//     let currentY = 50;

//     // ============ LOGO SECTION ============
//     if (logoBase64) {
//       try {
//         let imageData = logoBase64;
//         if (logoBase64.includes(',')) {
//           imageData = logoBase64.split(',')[1];
//         }
        
//         const logoBuffer = Buffer.from(imageData, 'base64');
        
//         // Logo positioned at top left with proper sizing
//         doc.image(logoBuffer, 50, currentY, { 
//           width: 140,
//           height: 50,
//           fit: [140, 50],
//           align: 'left'
//         });
        
//         currentY += 70; // Space after logo
//       } catch (logoError) {
//         console.error("Error adding logo:", logoError);
//         currentY += 20;
//       }
//     } else {
//       currentY += 20;
//     }

//     // ============ INVOICE TITLE & LINE ============
//     doc.fontSize(28)
//        .font('Helvetica-Bold')
//        .fillColor(brandPrimary)
//        .text('INVOICE', 50, currentY, { align: 'center', width: 495 });
    
//     currentY += 35;
    
//     // Professional horizontal line
//     doc.moveTo(50, currentY)
//        .lineTo(545, currentY)
//        .strokeColor(brandSecondary)
//        .lineWidth(3)
//        .stroke();
    
//     currentY += 30;

//     // ============ TWO-COLUMN LAYOUT: BILL TO & INVOICE DETAILS ============
//     const leftColX = 50;
//     const rightColX = 320;
//     const startY = currentY;
    
//     // LEFT COLUMN - BILL TO
//     doc.fontSize(10)
//        .font('Helvetica-Bold')
//        .fillColor(brandPrimary)
//        .text('BILL TO:', leftColX, startY);
    
//     let leftY = startY + 18;
    
//     // Customer name
//     doc.fontSize(13)
//        .font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text(invoice.customer_name || 'Customer Name', leftColX, leftY, { width: 240 });
//     leftY += 18;
    
//     // Company name
//     if (invoice.customer_company) {
//       doc.fontSize(11)
//          .font('Helvetica')
//          .fillColor(textGray)
//          .text(invoice.customer_company, leftColX, leftY, { width: 240 });
//       leftY += 16;
//     }
    
//     // Email
//     if (invoice.customer_email) {
//       doc.fontSize(9)
//          .font('Helvetica')
//          .fillColor(textGray)
//          .text(`Email: ${invoice.customer_email}`, leftColX, leftY, { width: 240 });
//       leftY += 14;
//     }
    
//     // Phone
//     if (invoice.customer_phone) {
//       doc.fontSize(9)
//          .text(`Phone: ${invoice.customer_phone}`, leftColX, leftY, { width: 240 });
//       leftY += 14;
//     }
    
//     // Address
//     const fullAddress = [
//       invoice.customer_address,
//       invoice.customer_city,
//       invoice.customer_state,
//       invoice.customer_zip_code,
//       invoice.customer_country
//     ].filter(Boolean).join(', ');
    
//     if (fullAddress) {
//       doc.fontSize(9)
//          .text(fullAddress, leftColX, leftY, { width: 240, lineGap: 2 });
//       leftY += 20;
//     }
    
//     // RIGHT COLUMN - INVOICE DETAILS
//     let rightY = startY;
//     const labelWidth = 90;
//     const valueX = rightColX + labelWidth;
    
//     // Invoice Number
//     doc.fontSize(10)
//        .font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text('Invoice #:', rightColX, rightY, { width: labelWidth, continued: false });
//     doc.font('Helvetica')
//        .fillColor(brandPrimary)
//        .text(invoice.invoice_number || 'N/A', valueX, rightY, { width: 150 });
//     rightY += 18;
    
//     // Issue Date
//     doc.font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text('Issue Date:', rightColX, rightY, { width: labelWidth, continued: false });
//     doc.font('Helvetica')
//        .fillColor(textGray)
//        .text(formatDate(invoice.issue_date || invoice.created_at), valueX, rightY, { width: 150 });
//     rightY += 18;
    
//     // Due Date
//     doc.font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text('Due Date:', rightColX, rightY, { width: labelWidth, continued: false });
//     doc.font('Helvetica')
//        .fillColor(textGray)
//        .text(formatDate(invoice.due_date), valueX, rightY, { width: 150 });
//     rightY += 18;
    
//     // Status Badge
//     doc.font('Helvetica-Bold')
//        .fillColor(textDark)
//        .text('Status:', rightColX, rightY, { width: labelWidth, continued: false });
    
//     const statusColors = {
//       'paid': '#10B981',
//       'pending': '#F59E0B',
//       'overdue': '#EF4444',
//       'draft': '#6B7280',
//       'sent': '#3B82F6'
//     };
//     const statusColor = statusColors[invoice.status] || textGray;
    
//     doc.font('Helvetica-Bold')
//        .fillColor(statusColor)
//        .text((invoice.status || 'DRAFT').toUpperCase(), valueX, rightY, { width: 150 });
    
//     // Set Y position after both columns
//     currentY = Math.max(leftY, rightY + 20) + 25;
    
//     // ============ ITEMS TABLE ============
//     const tableTop = currentY;
//     const tableLeft = 50;
//     const tableWidth = 495;
    
//     // Column definitions
//     const colSrNo = { x: tableLeft, width: 50 };
//     const colDesc = { x: tableLeft + 55, width: 310 };
//     const colAmount = { x: tableLeft + 370, width: 125 };
    
//     // Table Header
//     doc.rect(tableLeft, tableTop, tableWidth, 32)
//        .fillAndStroke(bgLight, borderGray);
    
//     doc.fontSize(10)
//        .font('Helvetica-Bold')
//        .fillColor(brandPrimary);
    
//     doc.text('Sr. No', colSrNo.x + 8, tableTop + 11, { 
//       width: colSrNo.width - 16, 
//       align: 'center' 
//     });
//     doc.text('Service / Description', colDesc.x + 8, tableTop + 11, { 
//       width: colDesc.width - 16 
//     });
//     doc.text('Charges (₹)', colAmount.x + 8, tableTop + 11, { 
//       width: colAmount.width - 16, 
//       align: 'right' 
//     });
    
//     let rowY = tableTop + 32;
    
//     // Table Rows
//     doc.fontSize(10)
//        .font('Helvetica')
//        .fillColor(textDark);
    
//     if (items && items.length > 0) {
//       items.forEach((item, idx) => {
//         const rowHeight = 32;
        
//         // Alternate row background
//         if (idx % 2 === 1) {
//           doc.rect(tableLeft, rowY, tableWidth, rowHeight)
//              .fill('#FAFAFA');
//         }
        
//         doc.fillColor(textDark);
        
//         // Serial number
//         doc.text((idx + 1).toString(), colSrNo.x + 8, rowY + 10, { 
//           width: colSrNo.width - 16, 
//           align: 'center' 
//         });
        
//         // Description
//         doc.text(item.description || 'Service', colDesc.x + 8, rowY + 10, { 
//           width: colDesc.width - 16 
//         });
        
//         // Amount
//         doc.font('Helvetica-Bold')
//            .text(Number(item.amount || 0).toFixed(2), colAmount.x + 8, rowY + 10, { 
//              width: colAmount.width - 16, 
//              align: 'right' 
//            });
        
//         doc.font('Helvetica');
//         rowY += rowHeight;
//       });
//     } else {
//       // Default row if no items
//       doc.text('1', colSrNo.x + 8, rowY + 10, { 
//         width: colSrNo.width - 16, 
//         align: 'center' 
//       });
//       doc.text('Service Charges', colDesc.x + 8, rowY + 10, { 
//         width: colDesc.width - 16 
//       });
//       doc.font('Helvetica-Bold')
//          .text(subtotal.toFixed(2), colAmount.x + 8, rowY + 10, { 
//            width: colAmount.width - 16, 
//            align: 'right' 
//          });
//       doc.font('Helvetica');
//       rowY += 32;
//     }
    
//     // Bottom border of table
//     doc.moveTo(tableLeft, rowY)
//        .lineTo(tableLeft + tableWidth, rowY)
//        .strokeColor(borderGray)
//        .lineWidth(1)
//        .stroke();
    
//     rowY += 30;
    
//     // ============ TOTALS SECTION ============
//     const totalsX = 330;
//     const amountX = 470;
//     const amountWidth = 75;
    
//     // Subtotal
//     doc.fontSize(11)
//        .font('Helvetica')
//        .fillColor(textDark)
//        .text('Subtotal (before GST):', totalsX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold')
//        .text(`₹${subtotal.toFixed(2)}`, amountX, rowY, { 
//          width: amountWidth, 
//          align: 'right' 
//        });
//     rowY += 20;
    
//     // GST
//     doc.font('Helvetica')
//        .fillColor(accentGold)
//        .text(`GST (${gstRate}%):`, totalsX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold')
//        .text(`₹${gstAmount.toFixed(2)}`, amountX, rowY, { 
//          width: amountWidth, 
//          align: 'right' 
//        });
//     rowY += 22;
    
//     // Divider line
//     doc.moveTo(totalsX, rowY)
//        .lineTo(amountX + amountWidth, rowY)
//        .strokeColor(borderGray)
//        .lineWidth(1)
//        .stroke();
//     rowY += 15;
    
//     // Total with background highlight
//     doc.rect(totalsX - 5, rowY - 5, 220, 30)
//        .fillAndStroke('#EEF2FF', brandSecondary);
    
//     doc.fontSize(13)
//        .font('Helvetica-Bold')
//        .fillColor(brandPrimary)
//        .text('Total Payable (with GST):', totalsX, rowY + 5, { width: 135 });
//     doc.fontSize(14)
//        .text(`₹${totalWithGst.toFixed(2)}`, amountX, rowY + 5, { 
//          width: amountWidth, 
//          align: 'right' 
//        });
    
//     rowY += 50;
    
//     // ============ NOTES SECTION ============
//     if (invoice.notes && invoice.notes.trim()) {
//       doc.fontSize(11)
//          .font('Helvetica-Bold')
//          .fillColor(textDark)
//          .text('Notes:', 50, rowY);
//       rowY += 16;
      
//       doc.fontSize(9)
//          .font('Helvetica')
//          .fillColor(textGray)
//          .text(invoice.notes.trim(), 50, rowY, { 
//            width: 495,
//            align: 'left',
//            lineGap: 3
//          });
//     }
    
//     // ============ FOOTER ============
//     doc.fontSize(9)
//        .font('Helvetica')
//        .fillColor(textGray)
//        .text('Thank you for your business!', 50, 750, { 
//          align: 'center', 
//          width: 495 
//        });
    
//     doc.fontSize(8)
//        .fillColor('#9CA3AF')
//        .text(`Generated on ${new Date().toLocaleDateString('en-IN', {
//          day: '2-digit',
//          month: '2-digit',
//          year: 'numeric'
//        })}`, 50, 765, { 
//          align: 'center', 
//          width: 495 
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

//above code is testing
// router.post("/:id/download", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { logoBase64 } = req.body; // Receive logo from frontend

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

//     // Create PDF
//     const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
//     doc.pipe(res);

//     // COLORS
//     const primary = '#1E40AF';
//     const secondary = '#3B82F6';
//     const accent = '#F59E0B';
//     const dark = '#111827';
//     const gray = '#6B7280';
//     const light = '#F3F4F6';

//     // ============ ADD COMPANY LOGO AT TOP ============
//     let logoHeight = 0;
//     if (logoBase64) {
//       try {
//         // Remove data URL prefix if present (data:image/png;base64,)
//         let imageData = logoBase64;
//         if (logoBase64.includes(',')) {
//           imageData = logoBase64.split(',')[1];
//         }
        
//         // Convert base64 to buffer
//         const logoBuffer = Buffer.from(imageData, 'base64');
        
//         // Draw logo at the top left
//         doc.image(logoBuffer, 40, 40, { 
//           width: 180,  // Adjust width as needed
//           align: 'left',
//           valign: 'top'
//         });
        
//         logoHeight = 80; // Reserve space for logo
//         doc.moveDown(3);
//       } catch (logoError) {
//         console.error("Error adding logo to PDF:", logoError);
//         // Continue without logo if there's an error
//       }
//     }

//     // Adjust starting Y position based on logo presence
//     const headerStartY = logoHeight > 0 ? 40 + logoHeight + 20 : 40;
//     doc.y = headerStartY;

//     // ============ REST OF YOUR PDF CODE ============
//     // HEADER
//     doc.fontSize(32).font('Helvetica-Bold').fillColor(primary).text("INVOICE", { align: "center" });
//     doc.moveDown(0.3);
//     doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(secondary).lineWidth(2).stroke();
//     doc.moveDown(1.5);

//     // TWO-COLUMN LAYOUT
//     const col1X = 40;
//     const col2X = 310;
//     const startY = doc.y;

//     // LEFT: BILL TO
//     doc.fontSize(9).font('Helvetica-Bold').fillColor(dark).text("BILL TO:", col1X, startY);
//     let leftY = startY + 16;

//     doc.fontSize(12).font('Helvetica-Bold').fillColor(dark);
//     doc.text(invoice.customer_name || "Customer", col1X, leftY, { width: 250 });
//     leftY += 16;

//     if (invoice.customer_company) {
//       doc.fontSize(10).font('Helvetica').fillColor(gray);
//       doc.text(invoice.customer_company, col1X, leftY, { width: 250 });
//       leftY += 14;
//     }

//     doc.fontSize(9).fillColor(gray);
//     if (invoice.customer_email) {
//       doc.text(`Email: ${invoice.customer_email}`, col1X, leftY, { width: 250 });
//       leftY += 12;
//     }

//     if (invoice.customer_phone) {
//       doc.text(`Phone: ${invoice.customer_phone}`, col1X, leftY, { width: 250 });
//       leftY += 12;
//     }

//     const addr = [invoice.customer_address, invoice.customer_city, invoice.customer_state, invoice.customer_zip_code, invoice.customer_country].filter(Boolean).join(", ");
//     if (addr) {
//       doc.fontSize(8).text(addr, col1X, leftY, { width: 250 });
//       leftY += 14;
//     }

//     // RIGHT: INVOICE DETAILS
//     let rightY = startY;
//     const labelW = 80;
//     const valueX = col2X + labelW + 5;

//     doc.fontSize(9).font('Helvetica-Bold').fillColor(dark);
    
//     doc.text("Invoice #:", col2X, rightY, { width: labelW, continued: false });
//     doc.font('Helvetica').text(invoice.invoice_number || "N/A", valueX, rightY, { width: 160 });
//     rightY += 16;

//     doc.font('Helvetica-Bold').text("Issue Date:", col2X, rightY, { width: labelW, continued: false });
//     doc.font('Helvetica').text(formatDate(invoice.issue_date || invoice.created_at), valueX, rightY, { width: 160 });
//     rightY += 16;

//     doc.font('Helvetica-Bold').text("Due Date:", col2X, rightY, { width: labelW, continued: false });
//     doc.font('Helvetica').text(formatDate(invoice.due_date), valueX, rightY, { width: 160 });
//     rightY += 16;

//     doc.font('Helvetica-Bold').text("Status:", col2X, rightY, { width: labelW, continued: false });
//     const statusColor = invoice.status === 'paid' ? '#10B981' : invoice.status === 'overdue' ? '#EF4444' : gray;
//     doc.font('Helvetica-Bold').fillColor(statusColor).text((invoice.status || "draft").toUpperCase(), valueX, rightY, { width: 160 });

//     doc.fillColor(dark);
//     doc.y = Math.max(leftY, rightY + 16) + 20;

//     // TABLE
//     const tableY = doc.y;
//     const colSrX = 40;
//     const colSrW = 50;
//     const colDescX = 95;
//     const colDescW = 360;
//     const colAmtX = 460;
//     const colAmtW = 95;

//     // Table Header
//     doc.rect(colSrX, tableY, colSrW + colDescW + colAmtW, 26).fillAndStroke(light, '#D1D5DB');
//     doc.fontSize(10).font('Helvetica-Bold').fillColor(primary);
//     doc.text("Sr. No", colSrX + 5, tableY + 9, { width: colSrW - 10, align: 'center' });
//     doc.text("Service / Description", colDescX + 5, tableY + 9, { width: colDescW - 10 });
//     doc.text("Charges (\u20B9)", colAmtX + 5, tableY + 9, { width: colAmtW - 10, align: 'right' });

//     let rowY = tableY + 26;

//     // Table Rows
//     doc.fontSize(9).font('Helvetica').fillColor(dark);
//     if (items && items.length > 0) {
//       items.forEach((item, idx) => {
//         const rowH = 28;
//         if (idx % 2 === 1) {
//           doc.rect(colSrX, rowY, colSrW + colDescW + colAmtW, rowH).fill('#FAFAFA');
//         }
        
//         doc.fillColor(dark);
//         doc.text((idx + 1).toString(), colSrX + 5, rowY + 9, { width: colSrW - 10, align: 'center' });
//         doc.text(item.description || "Service", colDescX + 5, rowY + 9, { width: colDescW - 10 });
//         doc.font('Helvetica-Bold').text(Number(item.amount || 0).toFixed(2), colAmtX + 5, rowY + 9, { width: colAmtW - 10, align: 'right' });
//         doc.font('Helvetica');
//         rowY += rowH;
//       });
//     } else {
//       doc.text("1", colSrX + 5, rowY + 9, { width: colSrW - 10, align: 'center' });
//       doc.text("Service Charges", colDescX + 5, rowY + 9, { width: colDescW - 10 });
//       doc.font('Helvetica-Bold').text(subtotal.toFixed(2), colAmtX + 5, rowY + 9, { width: colAmtW - 10, align: 'right' });
//       doc.font('Helvetica');
//       rowY += 28;
//     }

//     doc.moveTo(colSrX, rowY).lineTo(colSrX + colSrW + colDescW + colAmtW, rowY).strokeColor('#9CA3AF').lineWidth(1).stroke();
//     rowY += 25;

//     // TOTALS SECTION
//     const totLabelX = 340;
//     const totValueX = 480;
//     const totValueW = 75;

//     doc.fontSize(10).font('Helvetica').fillColor(dark);
//     doc.text("Total amount (before GST):", totLabelX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold').text(`\u20B9${subtotal.toFixed(2)}`, totValueX, rowY, { width: totValueW, align: 'right' });
//     rowY += 18;

//     doc.font('Helvetica').fillColor(accent);
//     doc.text(`GST (${gstRate}%):`, totLabelX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold').text(`\u20B9${gstAmount.toFixed(2)}`, totValueX, rowY, { width: totValueW, align: 'right' });
//     rowY += 18;

//     doc.moveTo(totLabelX, rowY).lineTo(totValueX + totValueW, rowY).strokeColor('#D1D5DB').lineWidth(1).stroke();
//     rowY += 12;

//     doc.fontSize(12).font('Helvetica-Bold').fillColor(primary);
//     doc.text("Total Payable (with GST):", totLabelX, rowY, { width: 135 });
//     doc.fontSize(13).text(`\u20B9${totalWithGst.toFixed(2)}`, totValueX, rowY, { width: totValueW, align: 'right' });
//     rowY += 30;

//     // NOTES
//     if (invoice.notes && invoice.notes.trim()) {
//       doc.fontSize(10).font('Helvetica-Bold').fillColor(dark);
//       doc.text("Notes:", 40, rowY);
//       rowY += 14;
      
//       doc.fontSize(8).font('Helvetica').fillColor(gray);
//       doc.text(invoice.notes.trim(), 40, rowY, { width: 515 });
//     }

//     // FOOTER
//     doc.fontSize(8).font('Helvetica').fillColor(gray);
//     doc.text("Thank you for your business!", 40, 760, { align: 'center', width: 515 });
//     doc.fontSize(7).text(`Generated on ${new Date().toLocaleDateString('en-IN')}`, 40, 775, { align: 'center', width: 515 });

//     doc.end();
//   } catch (error) {
//     console.error("Invoice PDF error:", error);
//     if (!res.headersSent) {
//       res.status(500).json({ error: "Failed to generate invoice PDF", details: error.message });
//     }
//   }
// });
// PREMIUM RESPONSIVE PDF WITH PERFECT ALIGNMENT
// router.get("/:id/download", async (req, res) => {
//   try {
//     const { id } = req.params;

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

//     const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
//     doc.pipe(res);

//     // COLORS
//     const primary = '#1E40AF';
//     const secondary = '#3B82F6';
//     const accent = '#F59E0B';
//     const dark = '#111827';
//     const gray = '#6B7280';
//     const light = '#F3F4F6';

//     // HEADER
//     doc.fontSize(32).font('Helvetica-Bold').fillColor(primary).text("INVOICE", { align: "center" });
//     doc.moveDown(0.3);
//     doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(secondary).lineWidth(2).stroke();
//     doc.moveDown(1.5);

//     // TWO-COLUMN LAYOUT
//     const col1X = 40;
//     const col2X = 310;
//     const startY = doc.y;

//     // LEFT: BILL TO
//     doc.fontSize(9).font('Helvetica-Bold').fillColor(dark).text("BILL TO:", col1X, startY);
//     let leftY = startY + 16;

//     doc.fontSize(12).font('Helvetica-Bold').fillColor(dark);
//     doc.text(invoice.customer_name || "Customer", col1X, leftY, { width: 250 });
//     leftY += 16;

//     if (invoice.customer_company) {
//       doc.fontSize(10).font('Helvetica').fillColor(gray);
//       doc.text(invoice.customer_company, col1X, leftY, { width: 250 });
//       leftY += 14;
//     }

//     doc.fontSize(9).fillColor(gray);
//     if (invoice.customer_email) {
//       doc.text(`Email: ${invoice.customer_email}`, col1X, leftY, { width: 250 });
//       leftY += 12;
//     }

//     if (invoice.customer_phone) {
//       doc.text(`Phone: ${invoice.customer_phone}`, col1X, leftY, { width: 250 });
//       leftY += 12;
//     }

//     const addr = [invoice.customer_address, invoice.customer_city, invoice.customer_state, invoice.customer_zip_code, invoice.customer_country].filter(Boolean).join(", ");
//     if (addr) {
//       doc.fontSize(8).text(addr, col1X, leftY, { width: 250 });
//       leftY += 14;
//     }

//     // RIGHT: INVOICE DETAILS
//     let rightY = startY;
//     const labelW = 80;
//     const valueX = col2X + labelW + 5;

//     doc.fontSize(9).font('Helvetica-Bold').fillColor(dark);
    
//     doc.text("Invoice #:", col2X, rightY, { width: labelW, continued: false });
//     doc.font('Helvetica').text(invoice.invoice_number || "N/A", valueX, rightY, { width: 160 });
//     rightY += 16;

//     doc.font('Helvetica-Bold').text("Issue Date:", col2X, rightY, { width: labelW, continued: false });
//     doc.font('Helvetica').text(formatDate(invoice.issue_date || invoice.created_at), valueX, rightY, { width: 160 });
//     rightY += 16;

//     doc.font('Helvetica-Bold').text("Due Date:", col2X, rightY, { width: labelW, continued: false });
//     doc.font('Helvetica').text(formatDate(invoice.due_date), valueX, rightY, { width: 160 });
//     rightY += 16;

//     doc.font('Helvetica-Bold').text("Status:", col2X, rightY, { width: labelW, continued: false });
//     const statusColor = invoice.status === 'paid' ? '#10B981' : invoice.status === 'overdue' ? '#EF4444' : gray;
//     doc.font('Helvetica-Bold').fillColor(statusColor).text((invoice.status || "draft").toUpperCase(), valueX, rightY, { width: 160 });

//     doc.fillColor(dark);
//     doc.y = Math.max(leftY, rightY + 16) + 20;

//     // TABLE
//     const tableY = doc.y;
//     const colSrX = 40;
//     const colSrW = 50;
//     const colDescX = 95;
//     const colDescW = 360;
//     const colAmtX = 460;
//     const colAmtW = 95;

//     // Header
//     doc.rect(colSrX, tableY, colSrW + colDescW + colAmtW, 26).fillAndStroke(light, '#D1D5DB');
//     doc.fontSize(10).font('Helvetica-Bold').fillColor(primary);
//     doc.text("Sr. No", colSrX + 5, tableY + 9, { width: colSrW - 10, align: 'center' });
//     doc.text("Service / Description", colDescX + 5, tableY + 9, { width: colDescW - 10 });
//     doc.text("Charges (\u20B9)", colAmtX + 5, tableY + 9, { width: colAmtW - 10, align: 'right' });

//     let rowY = tableY + 26;

//     // Rows
//     doc.fontSize(9).font('Helvetica').fillColor(dark);
//     if (items && items.length > 0) {
//       items.forEach((item, idx) => {
//         const rowH = 28;
//         if (idx % 2 === 1) {
//           doc.rect(colSrX, rowY, colSrW + colDescW + colAmtW, rowH).fill('#FAFAFA');
//         }
        
//         doc.fillColor(dark);
//         doc.text((idx + 1).toString(), colSrX + 5, rowY + 9, { width: colSrW - 10, align: 'center' });
//         doc.text(item.description || "Service", colDescX + 5, rowY + 9, { width: colDescW - 10 });
//         doc.font('Helvetica-Bold').text(Number(item.amount || 0).toFixed(2), colAmtX + 5, rowY + 9, { width: colAmtW - 10, align: 'right' });
//         doc.font('Helvetica');
//         rowY += rowH;
//       });
//     } else {
//       doc.text("1", colSrX + 5, rowY + 9, { width: colSrW - 10, align: 'center' });
//       doc.text("Service Charges", colDescX + 5, rowY + 9, { width: colDescW - 10 });
//       doc.font('Helvetica-Bold').text(subtotal.toFixed(2), colAmtX + 5, rowY + 9, { width: colAmtW - 10, align: 'right' });
//       doc.font('Helvetica');
//       rowY += 28;
//     }

//     doc.moveTo(colSrX, rowY).lineTo(colSrX + colSrW + colDescW + colAmtW, rowY).strokeColor('#9CA3AF').lineWidth(1).stroke();
//     rowY += 25;

//     // TOTALS
//     const totLabelX = 340;
//     const totValueX = 480;
//     const totValueW = 75;

//     doc.fontSize(10).font('Helvetica').fillColor(dark);
//     doc.text("Total amount (before GST):", totLabelX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold').text(`\u20B9${subtotal.toFixed(2)}`, totValueX, rowY, { width: totValueW, align: 'right' });
//     rowY += 18;

//     doc.font('Helvetica').fillColor(accent);
//     doc.text(`GST (${gstRate}%):`, totLabelX, rowY, { width: 135 });
//     doc.font('Helvetica-Bold').text(`\u20B9${gstAmount.toFixed(2)}`, totValueX, rowY, { width: totValueW, align: 'right' });
//     rowY += 18;

//     doc.moveTo(totLabelX, rowY).lineTo(totValueX + totValueW, rowY).strokeColor('#D1D5DB').lineWidth(1).stroke();
//     rowY += 12;

//     doc.fontSize(12).font('Helvetica-Bold').fillColor(primary);
//     doc.text("Total Payable (with GST):", totLabelX, rowY, { width: 135 });
//     doc.fontSize(13).text(`\u20B9${totalWithGst.toFixed(2)}`, totValueX, rowY, { width: totValueW, align: 'right' });
//     rowY += 30;

//     // NOTES
//     if (invoice.notes && invoice.notes.trim()) {
//       doc.fontSize(10).font('Helvetica-Bold').fillColor(dark);
//       doc.text("Notes:", 40, rowY);
//       rowY += 14;
      
//       doc.fontSize(8).font('Helvetica').fillColor(gray);
//       doc.text(invoice.notes.trim(), 40, rowY, { width: 515 });
//     }

//     // FOOTER
//     doc.fontSize(8).font('Helvetica').fillColor(gray);
//     doc.text("Thank you for your business!", 40, 760, { align: 'center', width: 515 });
//     doc.fontSize(7).text(`Generated on ${new Date().toLocaleDateString('en-IN')}`, 40, 775, { align: 'center', width: 515 });

//     doc.end();
//   } catch (error) {
//     console.error("Invoice PDF error:", error);
//     if (!res.headersSent) {
//       res.status(500).json({ error: "Failed to generate invoice PDF", details: error.message });
//     }
//   }
// });

// Create invoice (with logging for debugging)
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

// Update, delete, stats routes remain the same...
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




