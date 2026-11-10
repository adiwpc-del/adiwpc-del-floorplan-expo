# Floorplan System Architecture & Critical Invariants (LOCKED)

> [!IMPORTANT]
> **DO NOT REMOVE OR BYPASS THESE INVARIANTS**:
> These rules ensure that all 15 booths and venue elements on the canvas are recognized, hydrated, interactive, and synced with SQLite database across both the Admin Dashboard and Live Floorplan.

---

## 1. Fabric.js Object Serialization & Deserialization
Fabric.js v7 does not automatically preserve custom object properties (`isBooth`, `boothData`, `isVenueItem`, `venueData`, `id`) unless revived or manually assigned.

- **On Canvas Save (`toObject`)**:
  Always serialize with custom properties. Use `toObject([...])` — in Fabric 7 `canvas.toJSON()` takes NO arguments and silently drops custom props:
  ```javascript
  canvas.toObject([
    'isBooth', 
    'boothData', 
    'isVenueItem', 
    'venueData', 
    'isCustomGroup', 
    'isBackgroundBlueprint', 
    'blueprintData', 
    'strokeUniform', 
    'noScaleCache', 
    'id', 
    'name', 
    'src'
  ]);
  ```
- **On Canvas Load (`loadFromJSON`)**:
  Always call `hydrateBoothObject(obj, rawObjects[idx], dbBooths)` from `floorplanUtils.js` immediately after loading.
- **Type Checking**:
  Always use case-insensitive type checks (`o.type?.toLowerCase() === 'text'`, `'rect'`, `'activeselection'`). In Fabric 7, `type` is capitalized (`'Text'`, `'Rect'`, `'ActiveSelection'`).

---

## 2. Universal Booth & Venue Hydration (`floorplanUtils.js`)
`hydrateBoothObject(obj, rawObj, dbBooths)` provides self-healing hydration:
- Reads dimension (`3x3m`, `6x3m`, `6x6m`), booth code (`A-01` to `VIP-02`), tenant name, and status (`AVAILABLE`, `RESERVED`, `SOLD`, `FREE`).
- Populates `obj.isBooth = true` and `obj.boothData = { id, code, category, status, price, ownerName, widthM, heightM, facilities }`.
- Sets `isVenueItem = true` and `venueData` for stage, entrance, exit, restroom, cafe, and pillars.
- Syncs latest status, tenant, and price from database rows.

---

## 3. Backend Database Safety Lock (`floorplanRoutes.js`)
- **`POST /api/floorplan/save`**:
  - Automatically verifies that `booths` are resolved. If `booths` array is empty or omitted, `extractBoothsFromFabricJson(fabricJson.objects)` extracts the booths from the canvas objects.
  - Automatically tags all objects in `fabricJson.objects` with `isBooth: true` and `boothData`.
  - Atomically syncs the `booths` and `venue_items` SQLite tables in a transaction.

---

## 4. Live Floorplan Interactivity (`LiveFloorplan.jsx`)
- **Cursor**: `hoverCursor: 'pointer'` on all booths.
- **Hover**: Shows the floating info preview card with badge, category, size, price, and tenant.
- **Click**:
  - **Available / Free**: Opens `BookingModal` for exhibitor registration and payment simulation.
  - **Reserved**: Shows alert with booking in-progress status.
  - **Sold**: Shows alert with the tenant/brand name.
- **Stats Card**: Shows real-time unit counts and percentage:
  - Total: 15
  - Available: 8 (53%)
  - Reserved: 1
  - Sold: 6

---

## 5. Strict 1-to-1 Booth Record Mapping & Deduplication Lock
- **No Cartesian Products**: Never use un-grouped `LEFT JOIN orders` or `LEFT JOIN invoices` directly against the `booths` query in `statsRoutes.js` or `orderRoutes.js`. Always use scalar subqueries (`SELECT ... WHERE booth_id = b.id ... ORDER BY created_at DESC LIMIT 1`) so that 1 booth record in SQLite ALWAYS produces exactly 1 row in `exhibitorsList`.
- **Project Isolation**: Always include `floorplan_id` / `projectId` filter in booth & order joins to prevent cross-project row duplication.
- **Frontend Deduplication Guarantee**: Maintain Map/Set deduplication layer in `SalesCharts.jsx` and `ExhibitorTable.jsx` using unique key `${floorplanId}_${boothCode}` to guarantee zero duplicate booth/tenant listings across all pages.

---

## 6. Invoice PDF, A4 View & Database Hydration Lock (`invoiceRoutes.js` & `InvoiceA4View.jsx`)
- **Full DB Column Selection & JSON Parsing**: `GET /api/invoices`, `POST /api/invoices`, and `PUT /api/invoices/:id` MUST perform `SELECT *` from `invoices` and parse `items_json` & `bank_details_json` into native JSON arrays/objects in API responses.
- **Normalization Layer**: `InvoiceA4View.jsx` MUST maintain a data normalization layer (`inv`) mapping both `camelCase` (`clientName`, `companyName`, `totalAmount`) and `snake_case` (`client_name`, `company_name`, `total_amount`) properties.
- **One invoice row for every page**: `GET /api/invoices` and `GET /api/invoices/:id` both build the row with `INVOICE_ROW_SQL` + `invoiceRowMapper()`, so Manajemen Invoice, Data Exhibitor, the A4 document and WhatsApp show exactly the same invoice. Data Exhibitor opens the booth's real invoices (a picker when there are several) and never generates a document of its own; a booth without an invoice is offered "Buat Invoice".
  - Every exhibitor row carries `invoices` (active contract + facility invoices of that booth, precise matching §12), shown as buttons: Sales opens, prints and downloads what Finance issued. Editing, issuing and the layout editor stay with Finance / Super Admin (hidden in the UI, 403 on the server).
  - `findBooth()` resolves a multi-booth invoice code ("A-01+A-09") through its first booth, so the contract of a checkout with several booths or an auto-merge group opens like any other.
- **Editing an issued invoice** (`InvoiceEditModal`, the same form in both menus): client data via `PUT /api/invoices/:id` (a missing `items` never wipes the items); DP amount, contract PPN and display choices via `POST /api/invoices/:id/terms`.
  - The DP amount changes only while the DP is unpaid (409 `DP_ALREADY_PAID`); the unpaid Pelunasan follows (contract − DP). An unpaid "Penuh" invoice can be split into DP + Pelunasan (`POST /invoices` with `invoiceKind: 'dp'`).
  - A contract PPN change needs `changeContractTax` (409 `TAX_CHANGE_CONFIRM`), is refused on a fully paid contract, and also recomputes an unpaid DP.
  - `invoices.display_json` holds per-invoice choices (`INVOICE_DISPLAY_KEYS`): layout keys override Desain Layout Invoice for that invoice; `showDiscount`, `showContractBox`, `showBank`, `showNotes` default to shown. Hiding the discount shows the lines after the discount; the total never changes.
- **Item Fallback Guarantee**: If `items` array is empty, `InvoiceA4View` MUST fallback to generating item entries from `booth_code`, `booth_category`, and total amount so PDF export & A4 view NEVER render empty item tables or blank client names.

---

## 7. Multi-Project Master Brand Category Isolation Lock (`brandCategoryRoutes.js` & `SettingsPage.jsx`)
- **Project Scoping**: Brand categories MUST be scoped by `project_id` / `floorplan_id` in SQLite to ensure categories in one project do not pollute other projects.
- **Filtered Category Retrieval**: Category selectors in `ToolSidebar.jsx`, `ExhibitorTable.jsx`, and `BookingModal.jsx` MUST request project-specific brand categories via `GET /api/brand-categories?projectId=...`.
- **Save Per Project Action**: `POST /api/brand-categories/save-project` atomically persists project-specific category lists in SQLite.

---

## 8. Public Booking Checkout & Transactional Safety Lock (`orderRoutes.js` & `BookingModal.jsx`)
- **Atomic SQLite Transaction**: `POST /api/orders/checkout` MUST run inside an atomic `db.transaction()`:
  1. Inserts record into `orders` table.
  2. Updates booth status to `sold` / `reserved` and populates `owner_name` & `brand_category`.
  3. Creates the corresponding record in `invoices` table. Only exception: a staff "Booking Manual" (`deferInvoice: true` with `bookingType: 'booking'`, §27) reserves the booth now and gets its invoice later.
  4. Parses and updates `canvas_fabric_json` in `floorplans` table to keep canvas objects and SQLite database 100% in sync.

---

## 9. Preset Layout Management & Persistence Lock (`db.js`, `floorplanRoutes.js` & `NewTemplateModal.jsx`)
- **Preset Table Storage**: Preset layouts MUST be persisted in SQLite table `preset_layouts` (`id`, `key`, `title`, `description`, `tag`, `canvas_fabric_json`, `metadata_json`, `is_system`).
- **Save as Preset Action**: Admin can convert any active floorplan or template card into a Preset Layout via `POST /api/floorplan/save-as-preset`.
- **Preset Deletion**: Custom preset layouts (`is_system = 0`) CAN be deleted by admin users directly via `DELETE /api/floorplan/presets/:id`.
- **Dynamic Preset Hydration**: `NewTemplateModal.jsx` and `presetLayouts.js` MUST fetch and hydrate preset layouts dynamically from `GET /api/floorplan/presets`.

---

## 10. Universal Payment Status Authority Lock (`invoices` Table Authority)
- **Single Source of Truth**: The `invoices` table (`payment_status`) is the canonical master authority for payment status across the entire application (Manajemen Invoice, Exhibitor Directory, Dashboard Stats, Live Floorplan, Studio, Orders).
- **Universal Synchronization**: `syncPaymentStatusFromInvoices()` in `syncPaymentStatus.js` ensures that when finance changes payment status (`PAID`, `UNPAID`, `PENDING`, `CANCELED`) or booth status (`sold`, `reserved`, `available`) in the Invoice Management page, all linked records across `booths`, `orders`, and `floorplans.canvas_fabric_json` are immediately synced.
- **Derived Exhibitor & Stats Status**: Endpoints `/api/orders`, `/api/exhibitors`, `/api/stats`, and `/api/floorplan` derive payment status and booth status from the booth **contract** (all its active DP / Pelunasan / Penuh invoices, see §14), never from a single "latest" invoice.

---

## 11. Authentication, Role Access & Audit Trail Lock (`middleware/auth.js`, `middleware/audit.js`, `utils/roles.js`)
- **Every `/api` request** passes `authenticate → enforceAccessPolicy → stampActorIdentity → auditTrail` (mounted in `index.js`). Endpoints not listed in `ACCESS_RULES` require a login by default; only the Live Floorplan / booking / facility-portal reads & submits are `public`.
- **Roles**: `superadmin` (everything), `finance` (invoices, payment status, private booth discount), `sales` (see below), `operations` (Studio + Denah Operasional, see below and §17), `developer` (Pusat Maintenance only, §22), `facility` (the Fasilitas menu only, §46). Only `superadmin` and `operations` edit a floorplan (`canEditFloorplan`); `superadmin`, `sales` and `operations` register a tenant (`canRegisterTenant`).
- **Sales is limited to three menus** (`PAGE_ACCESS`: `floorplan`, `exhibitors`, `facilities` §46):
  - Studio is read-only (`canEditFloorplan(role)` → `readOnlyStudio` in `AdminDashboard.jsx`): the locked preview canvas, no tool sidebar / Property Inspector, no Simpan / Publish / Buat Baru / Tier / Preset / Blueprint, autosave off (`handleSaveDraft` returns). A click on any booth opens the booth pop up (Buat Invoice / Booking Manual / Beri Diskon, §27).
  - Sales books (Reserved) but never records a payment: `POST /orders/checkout` refuses `payment_gateway` (403) and an already booked booth (409 `BOOTH_TAKEN`) for this role.
  - Data Exhibitor: open, print, download and "Kirim WhatsApp" (`InvoiceA4View` `allowSend`) the invoices; no editing or issuing.
  - Server: every write under `/floorplan`, `/categories`, `/brand-categories`, `/invoices` (incl. `sync-booth-discount`) and `/ops/:id/copy-from` is refused for Sales (403). Its discount and invoice go through `/booth-actions/*` only (§27).
- **Operasional sees three menus** (`PAGE_ACCESS`: `floorplan`, `ops`, `facilities` §46) and uses every Studio feature (draw, move, price, tiers, presets, blueprint, save, publish) **and every Property Inspector feature**, like the Super Admin:
  - Client (`tenantLocked = !canRegisterTenant(role)` is false for this role): "Pilih Tenant Terdaftar", "Daftarkan Client Baru", "Lengkapi Biodata", "Lepas Tenant", booth status and the private discount ("Save Diskon"). The sidebar still hides "Katalog Invoice" (`canAccessPage(role, 'invoices')`).
  - Server: `OPERATIONS_AREA` includes `/floorplan`, `/categories` / `/brand-categories`, `/orders/(checkout|check-client|registered-clients|update-tenant|detach-tenant)`, `/invoices/sync-booth-discount` and `/facilities` (also in its `ACCESS_RULES` access); on those paths the role is staff (bookings are recorded as staff, like the Super Admin). `POST /floorplan/save` treats it like the Super Admin. The invoice, order list, exhibitor, stats, settings and user endpoints stay closed (403); on other public endpoints it is still treated as a visitor. When adding an endpoint or admin page, update BOTH `ACCESS_RULES` (server) and `PAGE_ACCESS` (client `utils/roles.js`).
- **Actor identity comes from the session only**: `adminName`, `deletedBy`, `restoredBy`, `confirmedBy`, `registeredBy` in request bodies are overwritten with the logged-in user's name; anonymous requests cannot set `source: 'admin'`.
- **Client API calls** must go through `apiFetch` (`services/session.js`) so the bearer token is attached and revoked sessions log the user out.
- **Audit**: authenticated mutations are written to `audit_logs` automatically; add a readable rule in `AUDIT_RULES` for new mutating endpoints.

## 12. Precise Booth Matching Lock (`syncPaymentStatus.js`, `orderRoutes.js`)
- Match a booth to an invoice/order ONLY by: exact code (case-insensitive), merged-code tokens (`('+' || code || '+') LIKE '%+' || X || '+%'`), or a **non-empty** booth id — always scoped to the floorplan.
- **Never** use substring matching (`LIKE '%' || code || '%'`: `A-1` hits `A-10..A-19`) or id matching on a possibly empty value (`id LIKE '%' || ''` matches every booth and once overwrote a whole project's tenants).
- Public checkout must reject booths that are already `sold`/`reserved` (409) or not found (404); staff may re-assign.
- Public registration: the visitor chooses Bayar Penuh or a DP of at least `publicMinDpPercent` (Setting > Aturan Booking, default 20%) and below 100%; other values get 400. **A visitor gets NO invoice**: public checkout is always a deferred booking (`deferInvoice`, like Booking Manual §27): booth Reserved, `orders.invoice_number = ''`, the chosen Bayar Penuh / DP % is stored only as a note in `orders.notes` ("Rencana pembayaran: …"), `order.invoice` is `null`, and the "Selesai" step tells the visitor to confirm through WhatsApp admin. Invoices are issued only by staff (Sales "Buat Invoice", Finance / Super Admin DP & Pelunasan wizard). There is no PDF token: `GET /invoices/:id/pdf` needs a login. Staff registrations (`req.user`) still issue the invoice at checkout. **One payment plan everywhere**: the visitor form (always shows the "Pilih DP atau Bayar Penuh" step, even when `isPaymentActive` is off), the Studio registration (status Reserved) and the Sales Booking Manual all offer Bayar Penuh or a DP %. It is stored in `orders.payment_type` / `dp_percent`; a staff checkout issues that invoice at once, and a deferred booking (visitor, Booking Manual) is followed by "Buat Invoice" (`/booth-actions/invoice`), which issues the Invoice DP through `createContractInvoice` when the plan is DP, otherwise the Penuh invoice. The Live page keeps the booking form open after a successful booking (`bookingModalBooths`) until the visitor closes it.
- Public registration is only a Hold 24 Jam (`manual_transfer` from a visitor is treated as `booking`); the API rejects any other `bookingType` from anonymous visitors (there is no real payment gateway). Instantly-PAID registrations (`payment_gateway` internally) are staff-only. A DP chosen at registration is a plan: `paid_amount` stays 0 until finance confirms payment.

## 13. Live Denah Shows Only the Published Floorplan (`floorplanRoutes.js`, `LiveFloorplan.jsx`)
- `GET /floorplan/events`, `/active` and `/:id` return **only `status = 'published'`, non-trashed** floorplans in the public view (anonymous visitors always; staff when `?view=public`). `/active` never falls back to a draft in the public view.
- `LiveFloorplan.jsx` must request `{ view: 'public' }` so a logged-in admin sees exactly what visitors see. The Studio calls these endpoints without it and still sees every project.
- `POST /orders/checkout` from visitors is only allowed on a published floorplan.
- **The title shown is the floorplan title** (the project name edited in the Studio header): the Live header and the PDF exports of Live and Studio. The Studio saves every floorplan under the shared event `EVT-2026-001`, whose title was copied once from the first floorplan ever saved (e.g. "Kanvas Baru") and is never updated, so never show `events.title` / `currentEvent.title` as a floorplan's name. Invoices too: every invoice row (`INVOICE_ROW_SQL` + `invoiceRowMapper`, so list, detail, A4, PDF, WhatsApp and the registrant's copy) sets `event_title` / `event_venue` from the floorplan (`project_title`, `metadata.event.venue`), whatever the invoice stored.
- **Several floorplans can be live at once**, each on its own link `/live/<public_slug>` (`floorplans.public_slug`, created on first publish and kept on re-publish). `POST /floorplan/:id/publish` never demotes other floorplans; `POST /floorplan/:id/unpublish` turns one back into a draft (its link then shows "Link Denah Tidak Ditemukan", never another floorplan). `/` and `/portal` show the most recently published floorplan.

## 14. Booth Contract Billing: Invoice DP & Pelunasan (`utils/contractBilling.js`)
- **Contract** = one booth in one floorplan. `invoices.invoice_kind`: `dp` (max one active), `settlement` (Pelunasan, max one active, `related_invoice_id` → its DP), `full` (single / legacy invoice, e.g. checkout drafts), `facility` (add-ons: never part of the contract, never change the booth).
- **Contract value** (`contract_total`, snapshot on every contract invoice) = booth price − private discount (+ PPN `contract_tax_rate`). Legacy invoices: contract value = their total.
- **Status per contract** (`summarizeContract`): paid ≥ contract → PAID / booth `sold`; paid > 0 → PARTIAL ("Uang Muka") / `reserved`; unpaid → UNPAID / `reserved`; all canceled → `available`. Always use `getContract()` / `summarizeContract()`; never read the latest invoice.
- **One registration = one invoice** (`POST /orders/checkout`): every booth ordered together goes on ONE invoice (`booth_code` "A-01+A-05+B-02", one item per booth with `boothCode`), adjacent or not. Checkout never splits an order per cluster and never appends it to an older invoice.
- **PPN choice** (`utils/taxSettings.js`): the rate is `taxRate` of the invoice configuration (Setting > Aturan Booking, PPN & Pajak).
  - Staff choose "Dengan PPN" / "Tanpa PPN" per invoice: checkout `applyTax` + `taxRate`, the DP / Pelunasan wizard for a contract without invoices, and the invoice edit form.
  - Visitors cannot choose: `publicBookingTax` (default true) decides.
  - Checkout computes the invoice itself: Σ price − private discounts, + PPN, stored in `tax_rate` / `tax_amount` / `contract_tax_rate`. The total sent by the form is ignored.
  - Editing a `full` invoice's total / PPN also updates its `contract_total` / `contract_tax_rate` (a full invoice is the whole contract).
- **Amounts are computed on the server** (`POST /api/invoices` with `invoiceKind: 'dp' | 'settlement'`). Pelunasan = contract − DP. `recalcContract()` rewrites only the unpaid balance invoice after a price/discount change or a DP cancel/delete; paid invoices are never rewritten. A DP turns an unpaid `full` invoice into the Pelunasan.
- An invoice that received a payment is deleted by the Super Admin only, after typing its number (Finance: 409 `INVOICE_PAID`, see §31); canceling a paid DP needs `confirmCancelPaidDp` and is written to the audit log. Deleted invoices are soft-deleted (`deleted_at`).
- **Client summaries** (`client/src/utils/invoiceSummary.js`) count each contract once (total, discount, paid, remaining) via `inv.contract`; tabs filter AND count by the contract status (`matchesStatusTab`), so a paid DP is "Uang Muka / DP", never "Lunas". After a status change the UI reports the booth status returned by the server, never the one it asked for.
- **A DP chosen at registration** is `downPaymentPercent` × the contract value computed by the server; the form's `paidAmount` estimate is ignored (a stale booth price once produced "DP 50%" billing 30%).


## 15. Exhibitor Directory: Tahun → Project → Tenant (`ExhibitorTable.jsx`, `ProjectYearFolderSelector.jsx`)
- The directory reuses `ProjectYearFolderSelector` with `mode="directory"` (project subfolders + `renderProjectContent`); `storageKey` keeps each page's open folders / preferences separate (Manajemen Invoice keeps the default `invoice_project`). Folder years use WIB (`getProjectDateInfo`).
- "Total Tagihan" is the booth contract value (price − private discount, see §14), also for booths without invoices; `contractMismatch` flags contracts issued before the booth was re-priced or merged.
- One booth, one tenant: `POST /orders/checkout` rejects (409) assigning a booth (or part of a merged booth) whose contract already received a payment from another tenant; release it first with "Lepas Tenant".

---

## 16. Element Caption Lock (`elementCaptions.js`)
- **Overlay, not objects**: Captions are painted in the canvas `after:render` event via `drawElementCaptions()` (Studio `CanvasEditor.jsx` and `LiveFloorplan.jsx`). Never add caption text as Fabric children: icons, selection bounds, and saved geometry must stay unchanged. Exports (`toDataURL` / PDF) render through the same event, so captions are printed automatically.
- **Data**: `venueData.caption` holds the custom text (`''` means use the short Indonesian default name from `defaultCaption()`). `venueData.showCaption === false` hides the caption for one element. Library elements and doors mirror the custom caption in `venueData.label`. The floorplan-wide switch is `metadata.display.showCaptions`.
- **Export**: `exportToPRDJson` writes `caption`, `captionText`, and `showCaption` into `venue_items.properties_json`.
- **Rules**:
  - Walls and `text_label` elements have no caption.
  - Captions hide below zoom `CAPTION_HIDE_ZOOM`.
  - Long text is shortened with "…"; hover or tap shows the full text.
  - Captions never cover booth labels. They auto-shift, or are skipped when no free spot exists.
  - Live shows captions only for visible (public) elements.

---

## 17. Denah Operasional: Operational Layer Lock (`opsRoutes.js`, `utils/opsLayer.js`, `OpsFloorplanStudio.jsx`)
- **One floorplan, two layers.**
  - The sales layer (booths, walls, structures, doors, stage, blueprint) is always read live from `floorplans.canvas_fabric_json`. It is never copied into the operational layer.
  - The operational layer lives in `ops_elements`. It holds one row per element with the Fabric object JSON, flagged `isOpsItem`.
  - Per-booth operations data lives in `ops_booth_data`: power, water, internet, setup status, notes, and **special design** (`special_design`, `special_color`).
  - Special design is the only booth "edit" the operations team has. It marks a custom-built stand and gives the booth its own colour on the operational floorplan: drawn by `drawOpsOverlay`, with a per-colour legend in the export. The sales booth object and its data are never changed.
  - Neither table ever writes to `booths`, `orders`, `invoices`, or the sales canvas.
- **Operations mode (`/admin/ops`) saves only the operational layer**, through `PUT /api/ops/:id` with optimistic locking on `baseVersion` (409 `OPS_VERSION_CONFLICT`).
  - Sales objects are loaded with `isSalesLayer`, locked, and dimmed at runtime. `onStateLoaded` re-applies this after every load and after undo/redo.
  - Serialize operational objects with `canvas._toObject(obj, 'toObject', OPS_SERIALIZE_PROPS)`. Objects inside an active multi-selection would otherwise be saved with relative coordinates.
- **Role `operations`.**
  - It can reach `/api/ops/*`, `/api/notifications/*`, its own account, and the Studio area (`/api/floorplan/*`, categories; `OPERATIONS_AREA` in `auth.js`, rules in §11).
  - On public endpoints outside that area it is treated as an anonymous visitor.
  - In Denah Operasional `sanitizeSalesCanvas` still strips prices, discounts, and billing data from boothData.
  - Sales can only read the layer: the "Lapisan Ops" overlay in the sales Studio uses `isOpsOverlay` + `excludeFromExport`, and `exportToPRDJson` skips those objects.
- **Anchors.**
  - `venueData.anchor = { boothId, boothCode, dx, dy, dAngle }`, with the offset expressed in the booth's own frame.
  - `resolveAnchors()` moves anchored elements onto their booth on every load, and flags `anchorOrphaned` when the booth was deleted. The element is never deleted.
  - `rebuildLibraryElement` must keep `anchor`, `anchorOrphaned`, `connections`, and `isOpsItem`.
- **Public visibility.** Operational elements are internal by default (`publicVisible: false`). Only the Super Admin may set `publicVisible` (the server enforces this). The Live Floorplan adds only `GET /api/ops/:id/public` elements.
- **Sales changes.**
  - `POST /floorplan/save`, checkout, and detach call `notifyIfBoothsChanged` / `notifyOpsOfSalesChange`, which create in-app notifications for operations users.
  - "Perubahan dari Sales" diffs the booth snapshot stored in `ops_seen` (updated when the page is opened with `markSeen=1`) against the current booths, and adds live updates while the page is open (15 s version polling).
- **Audit.** Operational saves write their own entries in category `Operasional`: add / change (coalesced per element for 10 minutes) / delete / booth data. They set `req.skipAudit`.

---

## 18. Auto-Merge Booth Lock (`shared/boothGroups.js`, `utils/boothMerge.js`, `boothMergeGroups.js`)
- **Booths never change.**
  - A merge group is display-only, computed from the canvas geometry (`computeMergeGroups`, one shared module for server and client).
  - Booth rows, positions, sizes, and prices stay as they are.
  - The client paints members through a runtime `render()` patch (`refreshMergeRendering`); nothing is saved in the canvas JSON.
  - Member corners are always scene coordinates (`coordsOf` maps a booth inside a multi-selection back through the selection's matrix: its `calcACoords()` is relative to the ActiveSelection). The group matrix is undone on the context only when the booth is painted by its group (`group._transformDone`); with `preserveObjectStacking` (Studio) the canvas paints it directly. Otherwise selecting every booth of a merged group made the shape vanish (only the selection box stayed).
- **Adjacency.**
  - Two booths merge only when they share a side: collinear, opposite-direction edges; gap ≤ `MERGE_GAP_M` (0.1 m); shared length ≥ `MIN_SHARED_M`. Touching at a corner does not count.
  - Walls, pillars, aisles, and other `MERGE_OBSTACLE_TYPES` lying on the shared side block the merge.
  - Groups chain (union-find). Only `reserved` / `sold` booths with the same `exhibitor_id` take part.
- **Exhibitor ID.**
  - `exhibitorIdFor(email, company)` in `utils/exhibitorIdentity.js`: a hash of the email, falling back to the company name for old data. Never compare brand-name text.
  - Stored in `booths.exhibitor_id` and `orders.exhibitor_id`. Kept by `syncPaymentStatus`, checkout, and floorplan save. Cleared on detach or Available.
- **Display switches.** `booths.merge_separate` / `boothData.mergeSeparate` ("Tampilkan Terpisah", set via `POST /floorplan/:id/merge-display`). Project-wide switch: `metadata.display.autoMerge`.
- **Checkout.**
  - One `POST /orders/checkout` with `boothCodes[]`. It is rejected with 409 plus `unavailable` when a booth was just booked.
  - One invoice for the whole registration, adjacent or not (§14). Adjacent booths are still SHOWN merged on the floorplan (the response's `contracts` lists those display groups).
- **Unmerge.** Detach or Available on one booth of a multi-booth contract uses `removeBoothFromInvoice`: an unpaid invoice is recalculated; a paid or DP invoice keeps its amounts, drops only the code, and returns a warning. Groups re-split automatically.
- **Contract value of "A-01+A-03" = sum of its booths** (`contractValueForCode`, used by `recalcContract`).
- **Private discount on a multi-booth contract**: "Simpan Diskon" (`POST /invoices/sync-booth-discount`) and a Studio save that changes a booth's price or discount (`POST /floorplan/save`, change detected against the booths table) both call `recalcContract`. The unpaid Penuh / Pelunasan then shows subtotal = sum of the booth prices, discount = sum of their discounts (one booth keeps its own type, e.g. 10%), booth lines at the booth prices, total with PPN. Never write discount / subtotal / total to an invoice directly (the old Studio-save sync matched only exact codes, dropped PPN and rewrote paid invoices).
- **Data Exhibitor.**
  - The API keeps one row per booth (§5), with `mergeGroup` and a per-booth share of the contract (`contractShare`).
  - `ExhibitorTable` and the Dashboard tenant table (`SalesCharts`) show one row per TRANSACTION (`collapseMergedRows`): booths of one auto-merge group and booths of one multi-booth contract (`contractShare.code`, also when they do not touch) become one row "#A-04+A-07+A-08" with summed money (incl. discount) and area. Booth counts (occupancy, categories) keep the per-booth rows.
  - The dashboard still counts original booths.

---

## 19. Sudut Booth & Snap Sesama Booth (`floorplanUtils.js`, `boothSnap.js`, `CanvasEditor.jsx`)
- **Sudut Booth is display only.**
  - The value is a % of the booth's shortest side (0–50, default 0 = siku). Radius = pct × shortest side, capped at half of it.
  - Global per floorplan: `metadata.display.boothCornerPct`, kept on `canvas.boothCornerPct`. Per booth: `boothData.cornerPct`, where null means "Ikuti Pengaturan Denah". The legacy shape "Sudut Membulat" (`rounded`) means 20% until a value is set.
  - Always go through `applyBoothCorners(canvas, pct)` / `effectiveCornerPct()`. It sets the rect `rx`/`ry` and keeps the category strip inside the corners. Studio, Live, Denah Operasional and exports all call it.
  - It is applied inside `onStateLoaded`, so opening a floorplan never marks it as changed.
  - Never use the corner in geometry: size, area, adjacency, snapping and price use the square rectangle.
- **Merged outline.**
  - `outlineLoops()` + `isConvexVertex()` round only convex corners; concave (inner) corners stay siku.
  - The top-most member paints the whole group, so touching sides never show a double line.
  - Members with different corner values use the floorplan setting.
- **Snap ke Booth for booths (sales Studio: `snapToBooths` prop).** In Denah Operasional booths stay locked; there "Snap ke Booth" only makes elements stick to booths (§25).
  - `computeSnap()` works on the real rectangle (AABB after 0/90/180/270° rotation, outer box of a multi-selection). Threshold: `SNAP_SCREEN_PX / zoom`.
  - Per axis: touch (side to side, only when the boxes face each other) or align (same side, any distance). The closest candidate wins; on a tie, touch wins. An axis without a booth candidate falls back to Snap to Grid.
  - Resize snaps the dragged side.
  - Arrow keys move 0,1 m (Shift: 1 m) and stop at a touching booth (`limitStepToTouch`).
  - Alt / Option disables snapping. Copy-by-drag is Ctrl/Cmd only.
  - Booth positions are rounded to 0,01 m on `object:modified`.
  - Overlapping booths are marked red, and a warning is shown after the move.
- **Save route:** `activeOrders` ignores canceled / deleted orders. Otherwise a released booth (unmerge / Lepas Tenant) came back as Reserved on the next Studio save.

---

- **Nama tenant di dalam booth: satu aturan (`utils/boothNameFit.js` `fitTenantName`).**
  - Used by single booths (`layoutTenantName` in `floorplanUtils.js`, called by `layoutBoothInternals` and by the Live page) and by merged groups (`drawGroupLabel` in `boothMerge.js`). Never add a second fitting logic.
  - Area = booth minus header (strip, size, number) and status. The largest font that fits, 1 line or 2 lines for several words (a single word is never cut), horizontal or vertical (rotated 90° counter-clockwise, bottom to top). Vertical only when > 10 % larger. Size between `MIN_NAME_M` (0,25 m) and `maxNameSize()`; below the minimum the name is cut with "…" (`group.__nameTruncated`).
  - The direction is decided from what is seen on the screen (`frameAngle` = booth angle): never upside down, never top to bottom. A rotation re-runs the layout (`object:modified` with action `rotate`, and `updateBoothAppearance` sets the angle before the layout).
  - Size, number, status and the "(Nama Pemilik)" placeholder stay horizontal in the booth's frame.
  - `boothData.nameDirection` ("Arah Nama Tenant": `auto` / `horizontal` / `vertical`) fixes the direction only; it is saved with the canvas, is public (`PUBLIC_BOOTH_FIELDS`) and reaches Denah Operasional (`OPS_BOOTH_FIELDS`). On a merged booth the editor writes it to every member.
  - Text widths and results are cached (`widthCache`, `resultCache`).

---

## 20. Public Data Protection Lock (`utils/publicData.js`)
- **Public view** of `GET /floorplan/active` and `/floorplan/:id` (anonymous visitors, or staff with `?view=public`) goes through `publicFloorplanPayload()`.
  - Canvas boothData is whitelisted: no `picName`, `email`, `phone`, `registeredBy`, or discounts.
  - Internal library elements are dropped.
  - Metadata keeps only event, floorplan, and display (the exported booth list carries discounts).
  - `exhibitor_id` / `boothData.exhibitorId` are replaced by an opaque per-floorplan alias (`PX-…`). Auto-merge only needs equality. The alias salt is `PUBLIC_ALIAS_SALT` (random per process if unset).
  - When adding a field to boothData or booth rows, decide explicitly whether it belongs in `PUBLIC_BOOTH_FIELDS`. Never show PIC, contact, or discount data publicly.
  - Staff booth rows (`boothRowDto` in `floorplanRoutes.js`) carry the tenant biodata saved at registration (`pic_name`, `email`, `phone`, `brand_category`, `registration_source`, `registered_by`) and the private discount, so the Studio's Property Inspector shows a registered tenant as complete instead of "Lengkapi Biodata". The public view strips them (`PUBLIC_BOOTH_ROW_FIELDS`).
- **`GET /orders/check-client`**: visitors receive only `{ exists }`. Contact details are returned to logged-in staff only.
- **`GET /invoices/config`**: visitors never receive the signature image.
- **CORS**: only localhost / 127.0.0.1 (any port) plus the origins listed in `ALLOWED_ORIGINS`.
- **`src/resetDb.js`** (wipes all projects and transactions) runs only with `ALLOW_DB_RESET=yes` and `--confirm-wipe`, never with `NODE_ENV=production`, and always writes `data/backups/pre-reset_*.db` first.
- **Checkout issues the invoice number itself** (never from the form): with `invoice_number UNIQUE`, a number chosen by a visitor could replace an existing, even paid, invoice. Invoices are inserted with plain `INSERT`, never `INSERT OR REPLACE`.
- **Organizer data shown to visitors comes from Setting**, never from client code: bank accounts (`bank1*` / `bank2*`), company name, WhatsApp (`supportWhatsapp`). The primary account is one account: saving Bank 1 in Setting updates the invoice layout fields (`bankName` / `accountNumber` / `accountName` / `bankBranch`) and vice versa (`BANK_FIELD_PAIRS` in `invoiceRoutes.js`); an older difference is never overwritten silently (Setting shows a warning).

---

## 21. Operations Lock: Git, Backup, Staging & Tests (`utils/backup.js`, `ops/`, `server/test/`)
- **Git**: `main` is the production branch. Changes are made on a branch (`fix/<nama-error>`, `feat/...`), tested, then merged. Never commit `server/data/`, `*.db`, backups, `.env` or `.staging/` (see `.gitignore`).
- **Secrets** live only in `server/.env` (template: `server/.env.example`), e.g. `ANTHROPIC_API_KEY`. Never in client code, `VITE_*` variables, logs, audit entries, or API responses. `db.js` loads `.env` before resolving `DATA_DIR`.
- **Backup**:
  - `createBackup()` uses the SQLite online backup, then verifies the copy with `integrity_check`, and writes `backup-status.json`.
  - The server makes one `daily` backup per day (`startBackupSchedule`, off with `BACKUP_DISABLED=1`).
  - Manual backup: `npm run backup`. Retention: `BACKUP_KEEP_DAILY` (14 days) and `BACKUP_KEEP_OTHER` (90 days).
  - Take a backup before every production migration or deploy. `/api/health` shows `lastBackupAt`.
- **Staging (this computer)**: `node ops/staging.mjs up <branch|commit>`.
  - It creates a git worktree in `.staging/app` and runs API on 5101 and web on 3101, with `APP_ENV=staging`.
  - Its database is `.staging/data`: a copy of production anonymized by `ops/mask-db.mjs` (no PIC names, emails, phones, addresses, NPWP, sessions, or audit IP; every staff password = `STAGING_PASSWORD`, default `staging123`).
  - Staging never reads or writes `server/data/`. The mask script refuses when source = target.
- **Tests**: `npm test` (root) = `npm run lint` + server tests (`server/test/*.test.js`, `node:test`) + client build.
  - `npm run lint` runs oxlint (client devDependency) with `no-undef` and `react/jsx-no-undef` as errors (`client/.oxlintrc.json`, `server/.oxlintrc.json` for server / shared / ops), so an icon or component used without an import fails the tests. Never turn these rules off.
- **Error boundaries**: the app-wide `ErrorBoundary` is the last resort. Pages with independent parts (the Pengaturan tabs) wrap each part in `SectionErrorBoundary` (`resetKey` = the tab), so one broken tab never takes the header and the other tabs down.
  - Each test file starts its own server on a free port with an empty temporary `DATA_DIR`. Never import server modules (`src/db.js` runs migrations) against `server/data/floorplan.db`.
  - Tests cover login/role access, public booking (draft 404, instant-paid 400, unknown 404, taken 409, no substring matching), contract DP + Pelunasan + discount, auto-merge (one invoice per group, adjacency rules), and public data protection.
  - Never disable or weaken a test to make a change pass.
- **Production starts clean** (`utils/demoCleanup.js`, `db.js`):
  - An empty database is never filled with demo data. `node server/src/seed.js` (demo event `EVT-2026-001` / `FP-2026-001`) is for local demos only.
  - Demo data that was auto-seeded on Railway is removed once at startup, only while untouched (the only floorplan, no invoices, only `ORD-2026-*` orders), after a verified backup. Real data is never deleted by this.
  - First account on production (`RAILWAY_ENVIRONMENT` or `INITIAL_ADMIN_PASSWORD` set): only a Super Admin (`INITIAL_ADMIN_EMAIL`, password `INITIAL_ADMIN_PASSWORD` or a random one printed once in the deploy log). The development accounts (`superadmin123`...) are public in the repository and exist only in development / tests; production logs a warning while one of them is still in use.
  - Locked out: set `RESET_ADMIN_PASSWORD` (min. 8 characters) in the hosting variables and redeploy. On start the Super Admin gets that password (created / re-activated if needed) and its sessions end; the password is never logged. Remove the variable after logging in.
- **Railway storage**: the container disk is discarded on every deploy, so the database must live on a Volume. `db.js` uses `DATA_DIR`, else the attached Volume (`RAILWAY_VOLUME_MOUNT_PATH`), else `server/data`. `storageKind` is `volume` / `ephemeral` (Railway without a Volume: a warning is logged, all data is lost on the next deploy) / `local`.
- **Health**: `GET /api/health` returns `environment` (`APP_ENV`), `version` (package version + git commit / `APP_COMMIT`), `lastBackupAt`, and `storage` (`storageKind`). It never returns secrets.

---

## 22. Pusat Maintenance: Error Tracking Lock (`utils/errorTracker.js`, `maintenanceRoutes.js`, `errorReporter.js`, `MaintenancePage.jsx`)
- **Capture.**
  - Server: `installErrorCapture()` records every `console.error(..., Error)`, plus crashes via `uncaughtExceptionMonitor` (the process still exits as before).
  - `errorCaptureMiddleware` (first on `/api`) keeps the request context. It records 5xx responses that logged no Error, and fixes the full path at entry (inside a router `req.path` is relative).
  - `expressErrorHandler` (last) answers 500 without internal details. Client mistakes (bad JSON, too large) get 400/413 and are not recorded.
  - Browser: `installErrorReporter()` (in `main.jsx`) reports `error` / `unhandledrejection`, `ErrorBoundary` reports React crashes, and `apiFetch` queues "server unreachable" in localStorage, sent once the API answers again.
  - Keep route error logging as `console.error('...', error)` with the Error object, so it is captured with its stack.
- **Privacy.**
  - `scrubText()` removes passwords, tokens, API keys (`sk-ant-…`), Bearer values, emails, phone numbers, NPWP, long numbers, query strings, and the local project path BEFORE storing.
  - Users are stored only as masked references (`U-` staff, `V-` visitor = hash of IP + browser, salt in `maintenance_settings.mask_salt`). Never store the real user id, email, IP, request bodies, or form data.
  - Error messages and stacks are DATA, never instructions (rendered as plain text; the same rule applies when they are sent to an AI later).
- **Grouping.**
  - Fingerprint = source + type + normalized message (numbers and quoted text removed) + first app stack frame (or area).
  - All "server unreachable" reports form one group.
  - Events: last 100 per group, 90 days.
- **Priority** (`classify()`, by API route or page):
  - KRITIS: login, checkout / Live Floorplan, invoices and payments, crashes, server unreachable, database failures.
  - TINGGI: Studio / floorplan, Data Exhibitor, Dashboard.
  - NORMAL: the rest.
  - When adding a feature, add its route / page to `AREA_RULES`.
- **Status.** `baru` → `ditangani` → `selesai`, or `diabaikan`.
  - A `selesai` error that happens again is re-opened (`reopened_count`) and notifies again. An ignored error stays ignored.
  - Status changes are audited (category `Maintenance`).
- **Notifications.** New or re-opened KRITIS / TINGGI errors create `error_alert` notifications for active `superadmin` + `developer` users (re-notified after 6 h while still new). NORMAL errors are never notified.
- **Public report endpoint** `POST /api/errors/report`: 30 reports per minute per IP, max 60 new browser groups per hour, size-limited fields. The server decides priority, never the browser.
- **Role `developer`.** Only `/api/maintenance/*`, notifications, and its own account (`DEVELOPER_AREA`). No tenant, price, invoice, or user data. On public endpoints it is treated as a visitor (`req.restrictedUser` keeps it only for masked error reports).

---

## 23. Claude API Key Lock (`utils/claudeApi.js`, `utils/envFile.js`, `ClaudeApiKeySettings.jsx`)
- **Where the key lives.**
  - Only in `server/.env` as `ANTHROPIC_API_KEY`. Never in the database, Git, client code, `VITE_*` variables, logs, audit entries, error reports, or API responses.
  - `utils/envFile.js` loads the file (imported first by `db.js`) and writes it atomically with mode 600. `ENV_FILE` redirects it (tests use their own temporary file).
- **Admin UI (Setting > Integrasi AI (Claude)), Super Admin only.**
  - `/api/maintenance/ai-key` is `access: []`. The Developer role cannot reach it.
  - The key is WRITE-ONLY. `PUT` receives it once. `GET` / responses return only `configured`, `hint` (`…` + last 4 characters), `source`, who changed it and when, and the last check. The input is a password field and is cleared after saving.
  - `PUT` checks the format (`sk-ant-…`, no spaces, quotes, or line breaks, so no `.env` injection), then calls `GET /v1/models` with the key.
  - A 401 / 403 rejects the key and nothing is stored. A network error, 429, or outage saves it with a warning.
  - A key set in the real process environment (`source: 'environment'`) cannot be changed or deleted from the UI.
- **Calling Claude.** Always through `claudeApi.js`: `x-api-key` + `anthropic-version: 2023-06-01`, base URL from `ANTHROPIC_API_URL` (tests point it at a local mock; tests never call the real API).
  - Failures map to Indonesian messages: 401 invalid, 403 forbidden, 429 rate limit, credit balance empty, 5xx outage, network.
  - Never put the key in thrown errors or `console.*`.
- **Audit.** Saving, testing, and deleting are audited (category `Maintenance`) without the value. `SENSITIVE_KEYS` in `audit.js` drops `apiKey` from request details.
- **Staging and tests never receive the production key** (`ANTHROPIC_API_KEY=''` is set by `ops/staging.mjs` and the test harness).


---

## 24. Text Box & Bentuk Lock (`elementLibrary.js` `ShapeBox`, `ShapeStyleSection.jsx`, `ShapeColorPicker.jsx`)
- **Elements** (tab Shapes, Studio and Denah Operasional): `textbox` (in "Teks & Pengukuran"), `shape_rect`, `shape_triangle`, `shape_parallelogram`, `shape_ellipse` (subheading "Bentuk"). They are library elements with `kind: 'shape'`, so they are saved, copied, exported, and listed like the others.
- **One object each: `ShapeBox`** (a Fabric `Textbox`, registered in `classRegistry`). It paints its shape behind the text.
  - The text wraps inside the shape (`SHAPE_TEXT_AREA`), is centred vertically, and is edited in place on the canvas.
  - Per-character colours are Fabric text `styles` and are saved with the object.
  - `boxHeight` (custom property) is the shape height. The object grows only when the text needs more room.
- **Size is real `width` / `boxHeight`, never a scale.**
  - `shapeControls()`: side handles resize one axis, corners resize both axes freely. Shift keeps the proportion; Alt / Option resizes from the centre (also when pressed mid-drag). Minimum `MIN_SHAPE_M` (0,2 m); no flipping.
  - Resize sticks to booth sides (`canvas.__snapShapeResize`, straight elements only). Moving follows Snap to Grid and Snap ke Booth (`snapsToBooths`).
  - `syncShapeElement()` on `object:modified` writes `widthM` / `heightM` / `label` to venueData. A size badge in metres is shown while resizing.
  - Never rebuild a shape with `createLibraryElement`: `rebuildLibraryElement` delegates to `updateShapeElement()` (in place) so text styles and an ongoing edit survive.
- **Colours** live in `venueData.props` (`SHAPE_STYLE_KEYS`):
  - fill colour + opacity or "Tanpa Isi";
  - border colour + opacity, width 0,5–10 px, `solid` / `dashed` / `dotted`, or "Tanpa Border";
  - text colour.
  - `applyShapeStyle()` applies `textColor` to the selected characters while editing with a selection, otherwise to the whole text (clears per-character fills).
  - The editor's `applyShapeStyle(style)` works on every shape in the selection, live, with one undo step per burst.
- **Panel "Warna"** (single element, Studio multi-select, Ops multi-select):
  - The palette includes the booth status colours (`STATUS_CONFIG`), plus a HEX input and the last 8 colours used (`floorplan_recent_colors`, this browser).
  - Salin / Tempel Gaya uses `floorplan_shape_style_clipboard`. "Jadikan Default" saves the style per element type in this browser (`floorplan_shape_defaults`) and is used by `defaultProps()` for new elements.
- No caption overlay for these types (`NO_CAPTION_TYPES`). Backspace / Delete never delete an element while its text is being edited.
- The older "Bentuk & Anotasi Vektor" palette (`ShapePalette`, `isBasicShape`) is separate and unchanged.

---

## 25. Snap ke Elemen Lock (`boothSnap.js`, `CanvasEditor.jsx`)
- **One snap system.** Elements (everything that is not a booth) use the same `computeSnap` / `computeGuides` / `limitStepToTouch` as booths, with the `elements` option. Called without it, every function behaves exactly as booth-to-booth snapping.
  - `server/test/snap.test.js` guards this.
  - A randomized old-vs-new comparison found 0 differences.
  - Never fork a second snap module.
- **Modes in `object:moving`.**
  - A selection that contains a booth uses booth mode (unchanged: booth targets + optional walls, overlap warnings).
  - Anything else uses element mode when "Snap ke Booth" or "Snap ke Elemen" is on. Targets come from `elementSnapTargets()`: booths (Snap ke Booth) and every visible element of every layer, incl. walls, pillars, doors, the ops overlay, and locked sales objects in Denah Operasional (Snap ke Elemen).
  - Targets are computed once per drag (`elementSnapCacheRef`).
- **Order.**
  1. Line elements (`LINE_TYPES`: walls, aisles, VIP lane, wheelchair path, measure, queue): an end snaps to another end or a corner (`snapLineEnds`).
  2. Otherwise sides / corners (touch, align incl. long-distance).
  3. Then, only on an axis without a side candidate, centre to centre or equal spacing (`equalSpacingCandidates`).
  4. Then the grid.
  - Threshold `SNAP_SCREEN_PX / zoom`. Alt / Option disables every snap.
  - Queue line vertices snap to anchor points (`canvas.__snapPoint`). Text Box & Bentuk resize snaps to booth and element sides.
- **Geometry (`snapGeometry`).**
  - Rotated elements use their outer box.
  - Library elements use their body (the hit area = group matrix × child matrix; a CCTV cone does not count).
  - Point-like library elements up to 1 × 1 m (Titik Listrik, WiFi, CCTV...) use their centre (`isPointElement`; shapes are never points).
  - Bulat / Segitiga / Jajaran Genjang use their outer box and centre.
- **Elements may overlap** booths and other elements: no warning and no blocking (the pillar-booth conflict rule stays). Element snapping never changes booths, contracts, or auto-merge adjacency. Element positions are rounded to 0,01 m after a drag.
- **Guides.** Pink = touching / shared point; indigo dashed = aligned; green dashed = centre to centre; orange with the gap in metres = equal spacing. The blue distance label is hidden when a centre / equal guide is shown. Booth overlap marks are off in Denah Operasional (`markBoothOverlaps={false}`).
- **Toolbar ("Grid & Skala").** Toggles: Snap to Grid, Snap ke Booth, Snap ke Elemen (all default on); Snap ke Dinding & Pilar (booth mode, sales only). Denah Operasional shows its own "Snap ke Booth" hint. `CanvasShortcutsGuide` is the "Panduan & Pintasan Kanvas" list in both studios.


---

## 26. Copy Lock: Duplikasi, Ctrl/Cmd + Drag, Ctrl/Cmd + C / V (`utils/copyRules.js`, `CanvasEditor.jsx` `addCopies`)
- **A copy is the original, not a template.**
  - Every copy path serializes the original with `canvas._toObject(obj, 'toObject', COPY_PROPS)` (absolute coordinates, also inside a multi-selection) and deep-copies it (`prepareCopy`).
  - It then revives it with `fabric.util.enlivenObjects` + `hydrateBoothObject` (same as loading a floorplan).
  - Never recreate a copy with `createVenueObject` / `createLibraryElement` / `createBoothObject`. That once turned every library element into a 12 × 6 m dark "Stage" and dropped colours, text styles, flip, and skew.
- **Only identity and position change.**
  - New `venueData.id` / `boothData.id` / `id`. Offset: +1 m (Duplikasi), 0 (the copy left behind by Ctrl/Cmd + drag), the pointer (Ctrl/Cmd + V on the canvas), or +1 m per paste.
  - Links (`anchor`, `anchorOrphaned`, `connections`) are dropped.
  - A booth copy keeps size, category, price, shape, corners, facilities, and rotation. It gets the next free code with the same prefix (`nextBoothCode`), status Available, and no tenant / contract / discount fields (`BOOTH_TENANT_FIELDS`).
  - "Jadikan Default" and templates never apply to copies. The booth hover glow is replaced by the resting shadow.
- **Layers.** The clipboard (`localStorage` `floorplan_canvas_clipboard`) works across floorplans and between Denah Sales and Denah Operasional.
  - `layerMode="ops"`: copies become operational items. Items coming from the sales layer are internal (`publicVisible: false`). Booths are not pasted (a warning is shown).
  - In Sales, `isOpsItem` is removed.
- **Multi-selection copies** keep their relative positions and become the new selection. The copy is placed right above its original (Duplikasi) or right below it (Ctrl/Cmd + drag).
- **Moving never changes an object.** `normalizeScaledObject` only runs on a real resize (scale ≠ 1): a plain move no longer rounds booth sizes to 0,1 m, recomputes venue label fonts, or grows venue shapes by their stroke.
- **Rebuilt elements are selected after the transform** (`selectAfterTransform` in `object:modified`). Selecting them immediately re-ended the transform: resizing a library element or door by its handles produced thousands of copies and a stack overflow.
- Tests: `server/test/copy.test.js`. Browser check: every element type × Duplikasi / copy-paste / Ctrl-drag / move gives an identical serialization except id & position.

---

## 27. Aksi Booth Sales Lock (`boothActionRoutes.js`, `utils/boothDiscount.js`, `SalesBoothActions.jsx`)
- **Pop up.** In the read-only Studio (role Sales) a click on any booth opens `SalesBoothActions`: a popover beside the booth on a wide screen, a bottom sheet below 768 px. It closes with a click outside (capture phase, so a click on another booth switches booths), the X button, or Esc. The open booth is outlined on the canvas (`highlightBoothCode`, drawn in `after:render`, never exported). The layout stays locked.
- **The server decides the buttons** (`actionsFor()` in `GET /api/booth-actions/summary`); the same function guards the POST endpoints, so the pop up and the API never disagree.
  - Available: all three. "Buat Invoice" on a booth without tenant leads to Booking Manual first (`mode: 'booking'`).
  - Reserved: "Buat Invoice" (or "Lihat Invoice" once one exists), "Lihat/Ubah Booking", "Beri Diskon".
  - Sold: only "Lihat Invoice"; the others are disabled with the reason.
  - Maintenance: everything disabled, "Booth sedang maintenance".
- **Booking Manual** = `POST /orders/checkout` with `bookingType: 'booking'` + `deferInvoice: true` (staff only): order + booth Reserved + tenant on the canvas (`applyBoothChangesToCanvas`), **no invoice yet** (`orders.invoice_number = ''`, note in `orders.notes`).
  - An open booking without invoice is never undone by older canceled invoices of the booth: `syncPaymentStatusFromInvoices` (`openBookingWithoutInvoice`) and `POST /floorplan/save` (`contractStateFor`) both skip the "all canceled → available" rule for it.
  - "Lihat/Ubah Booking" = `PUT /orders/update-tenant` (also `notes`).
- **Beri Diskon** = `POST /api/booth-actions/discount`. The form is `BoothDiscountFields` (shared with the Property Inspector); the save is `saveBoothDiscount()` (shared with `POST /invoices/sync-booth-discount`): booth row, `recalcContract`, canvas. Never write a second discount logic.
  - The price comes from the booth row, never from the request. The reason is mandatory for a discount > 0.
  - Sales limit (`readSalesDiscountLimit`, Setting > Aturan Booking): `salesMaxDiscountPercent` (default 10) of the booth price and, when > 0, `salesMaxDiscountAmount` rupiah. Above it: 403 `DISCOUNT_OVER_LIMIT`, nothing is saved (there is no approval queue). Only the Super Admin can change the limit (`POST /invoices/config` keeps the stored values for other roles). Finance / Super Admin are not limited.
- **Buat Invoice** = `POST /api/booth-actions/invoice`: one unpaid `full` invoice from `draftInvoiceRow(booth)` (price − private discount, PPN from Setting for Sales; totals from the form are ignored). The same row is the preview (`invoicePreview.invoice`, shown with `InvoiceA4View isLivePreview`).
  - Refused without a tenant (409 `NEED_BOOKING`) and when the contract already has a live invoice (409 `CONTRACT_HAS_INVOICES` + that invoice, shown as "Lihat Invoice"). The open order gets the invoice number.
  - The issued invoice opens in `InvoiceA4View` (`allowSend`): Download PDF, Print, Kirim WhatsApp. There is no public invoice link (§12, §20).
- **Access.** `/booth-actions/*`: Sales, Finance, Super Admin (`ACCESS_RULES`). Operations: 403 (outside `OPERATIONS_AREA`); visitors: 401.
- **Audit.** Discount and invoice write their own entries (category `Booth`, `req.skipAudit`) with the values before and after in the summary and `details_json`. Booking and tenant edits log "status (tenant) → status · brand" through `AUDIT_RULES` (`boothBefore`).
- **No reload.** Every action returns the fresh summary; `applyServerBooth` repaints that booth (`updateBoothAppearance`). The read-only Studio never saves the canvas: the server writes the same change into `canvas_fabric_json`.
- Tests: `server/test/sales-aksi.test.js`.

---

## 28. Browser Storage & Image Storage Lock (`utils/safeStorage.js`, `utils/localDraft.js`, `utils/storageCleanup.js`, `server/src/utils/uploads.js`)
- **The server is the only source of floorplan data.** Nothing large is mirrored in the browser. `api.saveFloorplan` once copied the whole canvas (with base64 images) into localStorage BEFORE calling the server, without try/catch: a full quota (~5 MB; Safari counts 2 bytes per character) threw "The quota has been exceeded." and the save never reached the server. Never write floorplan / canvas / invoice-layout data to localStorage again.
- **localStorage = small preferences only**: the session, open folders, view modes, toggles, recent colours, shape defaults, the canvas clipboard (max 1 MB, otherwise kept in the tab's memory), the queued "server unreachable" report.
  - New writes go through `safeSet()` (never throws; refuses values above `MAX_LOCAL_VALUE`). A failed storage write must never cancel the action that triggered it.
  - User-facing errors go through `friendlyError()`: a quota error reads "Penyimpanan browser penuh. Data tetap tersimpan di server."
  - `cleanupLegacyStorage()` (in `main.jsx`) removes the old keys (`LEGACY_KEYS`: `floorplan_draft_*`, `published_floorplan_*`, `invoice_template_config`, `registered_exhibitors`) every time the app opens. The old local draft copy is moved to IndexedDB (id `legacy`, 14 days) and is never pushed to the server automatically: an old browser copy must not overwrite newer server data.
- **Unsaved drafts live in IndexedDB** (`localDraft.js`, database `floorplan_local`, at most 5 drafts, 14 days). `api.saveFloorplan` keeps the payload there only when the server could not be reached; a successful save drops it. `offerDraftRestore()` asks once when that floorplan is opened again; restoring only loads the canvas, the next save sends it.
- **Undo / redo**: the last `MAX_HISTORY_STEPS` (20) states, in memory only.
- **Images are files, the database keeps URLs.**
  - `POST /api/uploads { dataUrl }` (Super Admin, Operations, Finance) stores PNG / JPG / WEBP / GIF / SVG up to 15 MB in `DATA_DIR/uploads/<sha256>.<ext>` (on Railway: the Volume) and returns `/api/uploads/<name>`. `GET /api/uploads/<name>` is public (the Live Floorplan shows the blueprint), immutable-cached, `nosniff` + a sandbox CSP (an SVG opened directly cannot run scripts). The name must match `UPLOAD_NAME_RE`.
  - URLs are stored relative (`/api/uploads/...`), so a domain change never breaks them. `externalizeImages()` runs on every `POST /floorplan/save` (canvas, blueprint, metadata) and `POST /invoices/config`: embedded base64 images become files and absolute upload URLs lose their domain, whatever the browser sent.
  - The invoice signature (`CONFIG_INLINE_KEYS`) stays inside the configuration: it is never public (§20).
  - `migrateEmbeddedImages()` runs at every start, after a verified `pre-migration` backup, and rewrites rows that still hold base64 (floorplans, preset layouts, operational elements, invoice configuration). After the first run nothing is left to move.
  - Client: `BlueprintModal` and the invoice logo upload through `api.uploadImage()`; if the upload fails the image is still used and the server stores it at the next save.
  - Development: Vite proxies `/api/uploads` to the API (`client/vite.config.js`). Staging copies `server/data/uploads` next to its database.
  - The database backup (`createBackup`) contains the URLs, not the image files: `DATA_DIR/uploads` must be kept with the Volume.
- Tests: `server/test/uploads.test.js`.

---

## 29. Registrasi Tanpa Email Lock (`shared/emailRule.js`)
- **The registration forms have no email field**: `BookingModal` (online registration and admin registration / edit), the Booking Manual form of `SalesBoothActions`. Nama PIC, Brand, Kategori and No. WhatsApp are required; WhatsApp is the contact. There is no "email wajib" setting (a stored `exhibitorEmailRequired` is ignored). Do not add the field back without being asked.
- **Email is never required and never blocks**: `POST /orders/checkout` and `PUT /orders/update-tenant` use `cleanEmail()`: a valid address already on file is kept, anything else becomes `NULL`. The Property Inspector's `isTenantComplete` does not look at the email. The duplicate warning of the form checks the phone number only.
- **Data already on file is not thrown away**: editing a tenant sends the existing email unchanged (`update-tenant` without `email` keeps the stored one); picking a registered tenant carries its email, and typing another brand name for a new booking drops it (it belongs to the picked tenant). User accounts (login) still use an email: that is unrelated.
- **Storage**: no email = `NULL` in `orders.email`, `booths.email`, `invoices.client_email`. The canvas `boothData.email` and API DTOs keep `''` (the client works with strings).
  - `orders.email` was created `NOT NULL`: `db.js` rebuilds the table once (copy of the database first with `VACUUM INTO backups/pre-migration_email-opsional_*.db`, same definition without the NOT NULL, all rows, indexes and triggers). If that ever fails the app keeps working and stores `''` (`ordersEmailNullable()`).
- **Identity without email**: `exhibitorIdFor(null, company)` falls back to the company name (§18), so auto-merge groups the booths of one brand by its name.
- **Display**: an empty email is not printed on the invoice (`showClientEmail && inv.client_email`) nor in the Property Inspector tenant block; Data Exhibitor shows "-". Older registrations keep showing their email. The application sends no email at all.
- Tests: `server/test/email-opsional.test.js`.

---

## 30. Nomor Booth Unik Lock (`shared/boothCodes.js`, `floorplanRoutes.js`, `CanvasEditor.jsx`, `PropertyPanel.jsx`)
- **One floorplan never holds two booths with the same number.** Invoices, orders and the checkout find a booth by its code (§12): a shared number would share one tenant, contract and status. Compared without case and outer spaces; a merged code "A-01+A-02" occupies both numbers (`boothCodeTokens`). The same number in another floorplan is fine.
- **Server (the guarantee):** `POST /floorplan/save` answers 409 `DUPLICATE_BOOTH_CODE` with `duplicates` and saves nothing when the canvas or the `booths` list repeats a number (`duplicateBoothCodes`). Never remove this check or rename booths silently on the server.
- **Studio (so it does not happen):**
  - New booths (button and drag from the sidebar) and copies take the next free number (`nextBoothCode` + `usedBoothCodes(canvas)`).
  - "Nomor / Kode Booth" in the Property Inspector: a number another booth has is not applied (`updateActiveProperty` refuses it too), the field shows the warning and returns to the booth's own number on blur. "+Next" skips used numbers.
- An older floorplan that already contains a repeated number opens normally; the next save names the numbers to fix.
- Tests: `server/test/booth-codes.test.js`.

---

## 31. Hapus Invoice, Tempat Sampah & Pulihkan Lock (`shared/invoicePermissions.js`, `invoiceRoutes.js`, `InvoiceDeleteModal.jsx`, `InvoiceTrashModal.jsx`)
- **One rule for pages and server** (`shared/invoicePermissions.js`, re-exported by `client/src/utils/invoicePermissions.js`): `canDeleteInvoice(user)` = roles `finance` (Keuangan) and `superadmin`; `canDeletePaidInvoice` / `canRestoreInvoice` = `superadmin`. No new role.
  - Pages do not render the delete icon / "Sampah Invoice" for other roles (not hidden with CSS). The server checks the session role itself: `DELETE /invoices/:id` 403 for other roles, `GET /invoices/trash` and `POST /invoices/:id/restore` 403 for everyone but the Super Admin (also in `ACCESS_RULES`).
- **`DELETE /api/invoices/:id { reason, confirmNumber }`** (soft delete):
  - `reason` is mandatory, at least `DELETE_REASON_MIN` (10) characters (400 `REASON_REQUIRED`).
  - An invoice with a payment (`invoicePaidAmount > 0`: DP / Lunas, any kind): Finance gets 409 `INVOICE_PAID`; the Super Admin must send `confirmNumber` = the invoice number (400 `CONFIRM_NUMBER`).
  - Stores `deleted_at`, `deleted_by`, `deleted_by_role`, `delete_reason`; a deleted DP is unlinked from its Pelunasan and `recalcContract` rewrites the unpaid balance (§14).
- **Only the invoice goes.** Tenant, booking, contact, brand category and the booth status stay: a booth without any invoice left keeps its status (`summarizeContract` gives no status, `syncPaymentStatusFromInvoices` skips it). The row in Data Exhibitor stays and shows "Belum ada invoice — buat".
- **Tempat Sampah Invoice** (`InvoiceTrashModal`, button "Sampah Invoice" in Data Exhibitor and Manajemen Invoice, Super Admin): lists invoices with `deleted_by` set. Restore is refused while the project is in the trash (409 `PROJECT_IN_TRASH`) or the booth already has a replacing contract invoice (409 `CONTRACT_HAS_INVOICES`); a restored DP is linked to its Pelunasan again.
  - `deleted_by` marks an invoice deleted on its own: `POST /floorplan/soft-delete` only touches live invoices and `POST /floorplan/restore` only brings back invoices without `deleted_by`.
  - An invoice number is never used twice: `invoice_number` is UNIQUE over deleted rows too and `nextInvoiceNumber` skips taken numbers.
- **One confirmation** (`InvoiceDeleteModal`, fed by `invoiceBriefOf()`): number, brand, booth, kind, amount, status, reason, and for a paid invoice the red warning + retyped number. Used by Data Exhibitor (one invoice: directly; several: a small list to choose one, never all), Manajemen Invoice and Katalog Invoice. Never delete with a bare `confirm()` again.
- **Audit**: "Hapus invoice" / "Pulihkan invoice" (category `Invoice`, `req.skipAudit`) with user, role, number, amount, paid amount, status and reason in `summary` / `details_json`.
- **Migration**: the columns are added by `db.js` at every start (local and Railway), like every other schema change; there is no separate migration command and no new environment variable.
- Tests: `server/test/hapus-invoice.test.js`.

---

## 32. Harga Booth Mengikuti Katalog Template Lock (`shared/templatePrice.js`, `utils/templatePricing.js`, `templatePriceRoutes.js`, `TemplatePriceSyncModal.jsx`)
- **One matching function**: `resolveTemplatePrice(booth, catalog)` in `shared/templatePrice.js` (server and Studio). A booth is matched to a template of the Katalog Template (`booth_categories`, the project's own rows plus `project_id = 'global'`) by SIZE only, never by name or colour.
  - `sizeKeyOf` normalizes: letter case, spaces, the unit "m", decimals (3.0 = 3) and orientation (2x3 = 3x2). 3,3 m is not 3 m.
  - Result `match` (one price), `none` (no template of that size; free tiers are not price templates), `conflict` (several templates of that size, also 2x3 next to 3x2, with DIFFERENT prices: nothing is chosen).
  - Auto-merge group (`resolveGroupTemplatePrices`): the total size when the group is a rectangle, shared between the members by area; otherwise each member's own template. A share is stored as Harga Khusus.
- **`booths.price_mode` / `boothData.priceMode`**: `template` (follows the catalog) or `custom` (Harga Khusus). The stored `booths.price` stays the value every other feature reads.
  - New booth: `initialPriceMode()` = `template` only when its price IS the template price of its size. Typing a price (also "Terapkan Harga Sewa Massal") = `custom`; "Reset ke Template" = `template`; a new size of a `template` booth takes the template price of that size (`followTemplatePrice` in `CanvasEditor.jsx`).
  - `POST /floorplan/save` is the authority: a `template` booth without invoice is saved with the template price whatever the canvas sent; a page that sends no mode keeps the stored one (a changed price = `custom`). The percentage discount follows the price, the nominal one stays.
  - A template added / changed / removed (`/categories`): `followTemplateChange()` re-prices every `template` booth without invoice in every project (audit "Harga booth mengikuti perubahan template"); the open Studio does the same on its canvas (`refreshTemplatePrices`).
  - Migration (`db.js`, every start, only rows without a mode): same price as the template = `template`, anything else = `custom`. No price changes at migration.
- **Locked by invoice**: a booth with a live contract invoice (`lockedBoothCodes`: Menunggu Bayar, DP, Lunas) is never re-priced automatically and its invoices are never rewritten by this feature (`price_locked` on staff booth rows, `boothData.priceLocked` at runtime, never stored). Changing it means deleting / re-issuing the invoice.
- **"Samakan Semua Harga dengan Template"** (button in the Katalog Template header of the Studio; `/api/template-prices/:floorplanId/preview | apply | undo`):
  - The preview saves nothing and groups the booths: `change`, `same`, `custom` (not ticked by default), `none`, `conflict`, `locked`. The Studio saves pending edits before opening it.
  - `apply { codes }` changes only `change` / `custom` booths, in ONE transaction (booths table + `canvas_fabric_json`), sets them to `template`, and stores the batch in `price_sync_batches` (old -> new price per booth).
  - `undo` restores the latest batch only, for booths that still have the batch's price and no invoice.
  - Access: `canSyncTemplatePrices` = `superadmin`, `finance`; Operasional and Sales get 403 and never see the button. (Finance has no Studio page, so in the Studio only the Super Admin sees it.)
  - Audit (category `Floorplan`): "Samakan harga booth dengan template" / "Batalkan samakan harga booth" with project, count and old -> new price per booth.
- Never add a second size-matching logic and never write a template price to a booth outside these paths.
- Tests: `server/test/harga-template.test.js`.

---

## 33. Hapus Tenant & Urungkan Lock (`shared/tenantPermissions.js`, `utils/tenantDelete.js`, `tenantRoutes.js`, `TenantDeleteModal.jsx`)
- **Super Admin only.** `canDeleteTenant(user)` (`users.role === 'superadmin'`) is the one rule for the page and the server. Data Exhibitor does not render the delete button, the checkboxes or the action bar for other roles; every `/api/tenants/*` endpoint answers 403 for them (handler check + `ACCESS_RULES`).
- **What a tenant is.** There is no tenant table: a tenant of a project is its bookings (`orders`) plus the booths it holds. A table row's `id` is a booking id (or the booth id for a tenant set in the Studio); `tenantOfRow(id)` resolves it to { project, brand, booth numbers }. A merged row "A-01+A-02" has one id per booth (`tenantRowIds`).
- **API** (all audited, category `Exhibitor`, with user, time, project, booth, brand, bill and payment status):
  - `GET /api/tenants/:id/summary` what the confirmation shows (PIC, category, bill, payment status, invoices, facility form).
  - `DELETE /api/tenants/:id { confirmBooth, alsoIds }` one row. A tenant with a payment or an issued invoice needs the booth number typed exactly (`sameBoothNumber`, 400 `CONFIRM_BOOTH`).
  - `POST /api/tenants/bulk-delete { ids, confirmText }` ONE transaction, all or nothing; "HAPUS" is required when any tenant has a payment / invoice (400 `CONFIRM_REQUIRED`).
  - `POST /api/tenants/:id/restore` ("Urungkan"; the id is the deleted row id or the deletion record) and `GET /api/tenants/trash`.
- **Soft delete in one transaction** (`planTenantDelete` + `executeTenantDelete`, nothing is hard deleted):
  - bookings: `orders.deleted_at` / `deleted_by`;
  - invoices: unpaid -> the invoice trash (§31); with a payment -> kept as `CANCELED` with the note "Dibatalkan – tenant dihapus" (bookkeeping, refund); a contract shared with booths that stay -> only this booth leaves it (`removeBoothFromInvoice`);
  - booths the tenant holds: Available, no tenant data, no private discount, auto-merge splits by itself, the price follows its rule again (`template` booths take the template price, §32); the saved canvas is updated (`applyBoothChangesToCanvas`), so the Studio, the Live Floorplan and Denah Operasional show the booth as Available;
  - facility requests: `facility_requests.deleted_at` (the list hides them);
  - a booth that meanwhile belongs to another tenant is never touched; the same brand in another project is never touched;
  - the deletion is stored in `deleted_tenants` (snapshot for the restore).
- **Restore** brings bookings, booths, invoices (also the canceled paid ones, to their previous status) and facility requests back. It is refused (409 `BOOTH_TAKEN`) when a booth is no longer Available and empty.
- **Page** (`ExhibitorTable.jsx`): ghost Trash2 button at the far right of AKSI ("Hapus tenant"), checkboxes + "pilih semua" per project, action bar "[n] tenant dipilih / Hapus Terpilih / Batal pilih", `TenantDeleteModal` (single and bulk; "Batal" has the initial focus), optimistic removal with rollback and an error toast, then a reload of the rows and booth counts, and the toast "Tenant ... dihapus" with "Urungkan" for 5 seconds.
- **Migration** (`db.js`, every start): table `deleted_tenants`, `orders.deleted_by`, `facility_requests.deleted_at` / `deleted_by`.
- Tests: `server/test/hapus-tenant.test.js`.

---

## 34. Invoice PDF & Print Lock (`utils/pdfRenderer.js`, `invoiceRoutes.js`, `InvoicePrintPage.jsx`, `utils/invoicePdf.js`)
- **Why it changed.** "Download PDF" used html2canvas, which cannot parse Tailwind v4's `oklch()` colours: it always failed and sent the user to "Print Invoice". Print copied the sheet into a blank frame and printed after a fixed 200 ms, before the built stylesheet (a file on the server) had loaded: a page of unstyled text. Never bring back html2canvas for the invoice, and never print before the stylesheet and fonts are in.
- **One template.** `InvoiceA4View` is the invoice everywhere: the on-screen preview, the layout editor's Live Canvas Preview, the print and the PDF. There is no second template for the PDF.
  - Print route `/print/invoice/:id` (`InvoicePrintPage`, no login wall): renders `InvoiceA4View` with `printMode` (the sheet alone, id `invoice-print-sheet`). Its data is injected: `window.__INVOICE_PRINT__` (server) or the opener's `__INVOICE_PRINT_PAYLOAD__` (the hidden print frame); opened directly, a logged-in user gets the invoice from the API. The page sets `data-print-ready="1"` once the stylesheet, `document.fonts` and every image are loaded.
  - The design comes from the database (`invoice_settings`, saved by "Simpan Desain"); nothing is read from localStorage.
- **Download PDF = the server.** `renderInvoicePdf()` (puppeteer-core + the system Chromium): opens the print route, waits for `networkidle0`, the ready mark and the fonts, then `page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })`. One browser, one PDF at a time, closed after 5 idle minutes, killed with the server.
  - `GET /api/invoices/:id/pdf`: any logged-in role that can open invoices; a registrant who is not logged in only with the signed 2-hour token of the checkout response (`order.invoice.pdfToken`, `pdfTokenFor` / `pdfTokenValid`; the design then has no signature image, §20). `POST /api/invoices/pdf-preview { invoice, config }` (Finance, Super Admin): a design that is not saved yet.
  - The print route is opened on this server (`http://127.0.0.1:<port>`); a page on another localhost port (the Vite dev server) is used instead; `PRINT_BASE_URL` overrides.
  - No Chromium (`chromiumPath()` null, or `PDF_ENGINE=off`): 503 `PDF_ENGINE_UNAVAILABLE`, `/api/health` shows `pdfEngine: false`, and the page falls back to "Print Invoice" (the browser's "Simpan sebagai PDF").
- **Print Invoice = this browser**, the same route in a hidden A4 frame (`printInvoice()`), printed when the page is ready.
- **Paper CSS** (`index.css`): named page `@page invoice { size: A4; margin: 12mm 14mm }` (the sheet's own margins on every page), colours forced with `print-color-adjust: exact`, table header repeated (`thead`), `.invoice-row` / `.invoice-keep` (totals block, signature block) never split, `.invoice-footer` stays with the signature, box-shadows left out on paper (Chromium prints them as grey boxes). The sheet uses the bundled font Inter (`@fontsource-variable/inter`), so every machine renders the same text.
- **Railway**: `railpack.json` installs `chromium` and fonts in the runtime image (`deploy.aptPackages`). A VPS needs `chromium` (or Chrome) installed, or `PUPPETEER_EXECUTABLE_PATH`.
- The facility form prints through `invoicePrintUtils.js` (`printInvoiceElement`, waits for the stylesheets) and downloads its PDF from the server (`/print/facility-form`, §46); html2canvas is no longer used for it.
- Tests: `server/test/invoice-pdf.test.js` (the real render is skipped without Chromium or `client/dist`).

---

## 35. Live Floorplan Background Refresh Lock (`floorplanRoutes.js` `/live-version`, `LiveFloorplan.jsx`)
- **Why.** The live page fetched the whole floorplan (4 requests) every 3 seconds, and each time the data differed it cleared the canvas, waited for the new objects and images, and re-fitted the view. On a real server that wait was a visible blink, and the visitor's zoom and position were lost.
- **Light polling.** `GET /api/floorplan/live-version?slug=|id=` (public) returns only `{ id, version }`: a hash of what the page shows (canvas, metadata, blueprint, booths, published operational elements, the public booking switches, the list of live floorplans). It is computed from stored data, never from the aliased public payload (§20), so it is identical on every server instance, and it does not run `syncPaymentStatusFromInvoices`.
  - The page checks it every `LIVE_POLL_MS` (5 s), on focus and when the tab becomes visible; never while the tab is hidden, and never while booths are selected or the booking form is open.
  - `loadFloorplan()` (the full fetch) runs on the first load, on a hall switch, after a booking, and only when the version changed. If the version cannot be read, a full check runs at most every 20 s.
- **No blank canvas** (`loadObjectsIntoCanvas`): never call `canvas.clear()` before `loadFromJSON`; the old drawing stays until the new objects, their images and the published operational elements are ready, then everything is swapped and painted once (`renderOnAddRemove = false`, one `renderAll()`).
  - The view is fitted only the first time a floorplan is shown (`fittedFloorplanRef`); a refresh keeps the visitor's `viewportTransform`.
- Tests: `server/test/live-version.test.js`. Browser check: idle = one small request per 5 s; a booking made elsewhere appears within ~5 s with no frame where the canvas is empty.

---

## 36. Cari Tenant / Booth Lock (`BoothSearch.jsx`, `utils/boothSearch.js`, `CanvasEditor.jsx`)
- **Where.** Floorplan Studio: in the header (`TopNavbar` prop `boothSearch = { getBooths, onPick }`, fed by the editor's `getSearchableBooths()` / `focusBooth()`), fixed width `w-44 xl:w-56`; the result list is portalled to `<body>` (`position: fixed`) because the header is `overflow-hidden`. To make room, the labels of Template, Tier Harga, Jadikan Preset, Blueprint, Lapisan Ops and Denah Operasional are icon-only below `2xl` (their `title` keeps the name) and the project switcher may shrink. Denah Operasional: on the canvas, top left (`CanvasEditor` prop `boothSearch`). Rendered for every role that opens those pages except Keuangan (`user?.role !== 'finance'`; Keuangan has no Studio page today, the check keeps it so if that changes). The Live Floorplan keeps its own "Cari Booth".
- **Matching** (`searchBooths`, client only, on the booths of the open canvas): tenant name (`boothData.ownerName`) or booth number, letter case and a leading "#" ignored, a merged number "B-01+B-02" found by either part. Order: exact number, number prefix ("A-1" never finds "A-01"), tenant word prefix, then substring. At most 8 results; each shows the status colour, number, tenant (or "Belum ada tenant") and status.
- **Picking a result** (click, or arrows + Enter; Esc clears): `focusFoundBooth()` centres the booth, zooms in to at least ~140 px (max 3x), outlines it for 2.4 s (`searchFlashRef`, drawn in `after:render`, never exported), then opens it like a click: the Sales pop up (`onBoothAction`), the page's own handler (`onBoothFound`, Denah Operasional's inspector), or selects it (Property Inspector).
- On a canvas that shows the search box (Denah Operasional) the preview notice moves down (`top-[4.5rem]`), so they never overlap.
- Tests: `server/test/booth-search.test.js`.

---

## 37. Status Booth dari Property Inspector Lock (`floorplanRoutes.js` `/:id/booth-status`, `utils/boothStatus.js`, `PropertyPanel.jsx`)
- **Why.** `POST /floorplan/save` restores the status of a booked booth from its booking / invoice contract on every save (stale editor saves must never erase a live booking). The status buttons only changed the canvas, so Reserved → Sold (or back) of a booth with a tenant came back after the autosave / a refresh. Never "fix" this by letting the canvas status win in the save route.
- **Booth with a tenant** (`boothData.ownerName`): the button calls `POST /api/floorplan/:id/booth-status { boothCode, status }`; the editor applies the status the server returns.
  - Sold / Reserved go through `applyBoothStatusToContract()` (shared with the Dashboard's `PATCH /stats/booth/:id/status`): Sold = live contract invoices PAID + orders PAID; Reserved = a paid balance invoice reopened, a paid order back to `PENDING`. Canceled orders are never revived. Then `syncPaymentStatusFromInvoices()` and the canvas (`applyBoothChangesToCanvas`).
  - A booth with live invoices needs `confirmPayment` (409 `CONFIRM_PAYMENT`, shown in the Inspector with "Ya, ubah ke …" / "Batal"); only Finance / Super Admin may change it (403 `STATUS_FOLLOWS_INVOICE` for Operations). A booking without invoice: Super Admin and Operations.
  - Available opens "Lepas Tenant"; Maintenance is refused until the tenant is released (409 `DETACH_TENANT_FIRST`).
- **Booth without tenant**: Available ↔ Maintenance stay a canvas change (the save stores it); a booth not saved yet (404 `BOOTH_NOT_SAVED`) is changed on the canvas only.
- Tests: `server/test/status-booth.test.js`.

---

## 38. Chat Antar Staf Lock (`chatRoutes.js`, `utils/chatSocket.js`, `components/chat/*`)
- **Who.** Every staff role chats (`/chat` is `staff` in `ACCESS_RULES` and part of `OPERATIONS_AREA` / `DEVELOPER_AREA`). Private: only the members of a conversation read or write it, the Super Admin included (403). A direct chat is one conversation per pair (`chat_conversations.direct_key` = sorted "idA|idB"). Groups are created, renamed and changed by the **Super Admin only** (handler check, 403 for others); a removed member loses access to the group.
- **Transport.** Every write goes through REST (`POST /chat/direct`, `/chat/conversations/:id/messages`, `/read`, `/chat/groups…`), so login, access policy and validation stay in one place. socket.io (same HTTP server, `attachChatSocket(httpServer, corsDelegate)`, same CORS rule as the API) only pushes `chat:message`, `chat:receipt`, `chat:conversation` to the rooms `user:<id>` of the members. The socket logs in with the session token (`userFromToken`, shared with `authenticate`); deactivation / role change / password reset calls `disconnectUser`. A client that reconnects reloads the list and the open conversation, so nothing is missed.
- **Ticks.** `chat_members.last_delivered_id` (a member's page received it: socket online at send time, or the list was opened) and `last_read_id` (`POST …/read`). Own message: ✓ sent, ✓✓ delivered, blue ✓✓ read — in a group only when every active member is there (`tickOf`). Unread = messages after `last_read_id` from others; the rail badge and the tab title show the total.
- **Privacy.** Message text never reaches the audit log (the chat routes set `req.skipAudit`; `auditTrail` keeps no request details for `/chat/*`, not even for a 403) nor error reports. Only group management is audited (category `Chat`).
- **Attachments are references.** A message stores `{ type: 'booth', floorplanId, boothCode }` or `{ type: 'invoice', invoiceId }`, never the data. The sender must be allowed to open it (booth: all roles but Developer; invoice: Super Admin, Finance, Sales). `GET /chat/attachment` resolves the card with the READER's rights: without access only `{ allowed: false }`. A booth card opens the Studio at `?templateId=…&booth=…` (`AdminDashboard` focuses it); an invoice card opens `InvoiceA4View`.
- **Limits.** Text max 4.000 characters, group name max 80, 50 messages per page. An inactive account cannot receive new direct messages (409 `USER_INACTIVE`).
- **UI.** `ChatDock` (rail button above Notifikasi on every admin page + panel beside the rail: list | conversation; on a phone one at a time), `ChatThread`, `ChatPeoplePicker` (Chat Baru, Grup Baru, Atur Grup), `ChatAttachment`, state in `useChat`.
- Tests: `server/test/chat.test.js`.

## 39. Hemat Egress Lock (`index.js` `compression`, `floorplanRoutes.js` `/:id/booth-version`, `AdminDashboard.jsx`)
- **Why.** Railway bills egress, and it was 94% of the bill: the Studio downloaded the whole floorplan (~3.4 MB of JSON, uncompressed) every 3 seconds, also in a hidden tab (≈68 MB per minute per open Studio).
- **gzip.** `app.use(compression())` compresses every response (a floorplan ~3.4 MB → ~110 KB). Never remove it, and never add a route that streams large JSON around it.
- **Studio sync.** `GET /api/floorplan/:id/booth-version` (staff; drafts too) = a sha1 of the booth fields the Studio syncs (`code, status, owner_name, exhibitor_id, merge_separate`). The Studio checks it every `BOOTH_SYNC_MS` (5 s), only while the tab is visible and on `visibilitychange`; the first answer after opening is the baseline; the whole floorplan is fetched (and merged by `syncBoothsFromDb`) only when it changed, and the version is kept only once that sync ran (a selected booth postpones it). Positions and prices are not in the fingerprint, so the Studio's own edits never trigger a download.
- **Never poll a full floorplan / list on a timer again.** Poll a small fingerprint (like `/live-version`, §35) and fetch the data when it changes; stop while `document.hidden`.
- Tests: `server/test/hemat-egress.test.js`. Browser check: an idle Studio = one ~200-byte request per 5 s; a booking made elsewhere appears within ~5 s.

---

## 40. Angka Dashboard & Nomor Booth Bersih Lock (`statsRoutes.js`, `SalesCharts.jsx`, `shared/boothCodes.js` `cleanBoothCode`)
- **Uang masuk is not "lunas".** `totalRevenue` = all money received (PAID invoices + paid part of PARTIAL). The dashboard card is "Uang Masuk (Diterima)" with the split `paidInFullAmount` / `paidInFullInvoices` (PAID, not a DP invoice) and `downPaymentAmount` / `downPaymentInvoices` (a paid DP invoice or a PARTIAL one).
- **Booked but not billed.** `unbilledBooths` = Reserved / Sold booths without any live contract invoice (`getContractInvoices`, canceled ones ignored), with `unbilledCount` / `unbilledValue` (price − private discount). Their value is in no invoice total: the "Sisa Tagihan" card says it counts issued invoices only and adds "+ n booth booking belum ditagih"; the dashboard lists them ("Lihat Daftar"), Sold ones called out (no payment recorded).
- **"Nilai Booth Tersedia"** = `availableValue` (Available, non-Free booths), not potential − received − remaining.
- The year view aggregates the project list and has none of these fields: the cards fall back to the old wording there.
- **Booth numbers are stored clean**: `cleanBoothCode` (no outer / repeated spaces, "A-01 + A-02" → "A-01+A-02") on `POST /floorplan/save` (canvas + booth list) and on blur of "Nomor / Kode Booth". `db.js` cleans old data once (booths, orders, invoices incl. item `boothCode`, saved canvases) after `VACUUM INTO backups/pre-migration_nomor-booth_*.db`; a booth whose clean number is taken in its floorplan is left as it is.
- The shared event title ("Kanvas Baru", §13) is not shown on the project cards of Manajemen Invoice / Data Exhibitor (`ProjectYearFolderSelector`).
- Tests: `server/test/dashboard-angka.test.js`.

## 41. Live Floorplan Cepat Lock (`LiveFloorplan.jsx`, `App.jsx`, `index.js` static cache, `utils/uploads.js` WebP)
- **Why.** The Live page took ~3.5 s (first visit) on Railway in San Francisco: 780 KB of JavaScript (the whole admin app), five data requests one after another, a 949 KB PNG blueprint, and a flash of "Belum Ada Event Aktif" while loading.
- **Requests in parallel.** `loadFloorplan()` starts events + invoice config together with the floorplan request; as soon as the floorplan data is in, `prefetchCanvasExtras()` starts the published operational elements and the canvas images (same `crossOrigin` as Fabric, so the cached copy is reused). `loadObjectsIntoCanvas` uses the prefetched operational elements only when they are for that floorplan and < 10 s old. Never chain these requests again.
- **Loading state.** Until the first floorplan is painted (`canvasReady`) the canvas shows "Memuat denah…" and the header a skeleton; the empty state ("Belum Ada Event Aktif") only after loading finished without a floorplan.
- **Code splitting.** `App.jsx` keeps only the Live page (and its layout) in the main bundle; every other page is `React.lazy` inside one `Suspense`. The Live page loads `BookingModal` / `CartDrawer` lazily when opened. Main bundle 808 KB → ~373 KB gzip. Do not import an admin page or a heavy library statically from the Live page.
- **Browser cache.** `/assets/*` (hashed names) `public, max-age=31536000, immutable`; `index.html` and every app route `no-cache`.
- **WebP.** A PNG upload ≥ 64 KB gets a lossless WebP copy (`cwebp -lossless`, same pixels) next to it (`<name>.png.webp`, made in the background on upload or on the first request, kept only when smaller); `GET /api/uploads/<name>.png` sends it to browsers whose `Accept` has `image/webp` (`Vary: Accept`). URLs and the database never change. `railpack.json` installs `webp`; without `cwebp` the PNG is served as before. `DATA_DIR/uploads` keeps the copies (they can be regenerated).
- Tests: `server/test/live-cepat.test.js`.

---

## 42. Kop Surat Invoice Lock (`InvoiceA4View.jsx` `KopFrame`, `InvoiceEditorModal.jsx`, config `letterheadUrl`)
- **What.** Desain Layout Invoice > Logo & Posisi > "Kop Surat (Background)": upload / replace / remove one A4 image (PNG, JPG, WEBP). It is the background of the whole sheet; the invoice is drawn over it exactly as without it (same layout, same 12 × 14 mm margins). Stored as a file through `api.uploadImage` (§28); the layout keeps `letterheadUrl`. It is public like the logo (the registrant's PDF shows it), unlike the signature.
- **Screen.** An absolutely positioned `<img>` (210 × 297 mm, `z-index: -1`, sheet `isolation: isolate`) behind the content.
- **Print / PDF (one template, §34).** The letterhead must cover the whole paper on every page: `@page invoice { margin: 0 }` (a style inside the sheet) and a `position: fixed` `<img>` (repeated on each printed page). `KopFrame` wraps the content in a table whose empty head / foot rows (12 mm, repeated by Chromium on every page) give each page its margins. Chromium only repeats such rows while they are < 1/4 of the page, and clips fixed elements to the page area when the page has margins: keep this structure. It is an `<img>`, not a CSS background, so the print page waits for it before the PDF is made.
- Tests: `server/test/kop-surat.test.js`. Browser check: a server PDF with a letterhead has it on every page and the invoice over it.

---

## 43. Volume Padat Lock (`db.js` VACUUM at start, `utils/backup.js` `VACUUM INTO`, `compactOldBackups`)
- **Why.** The Railway Volume (434 MB) was 90% full: the database file was 30 MB but 76% free pages (base64 images moved to files, §28, leave freed pages behind), and every backup copied the whole file (12 × 30 MB). With 14 daily backups the Volume would always fill.
- **Database.** At start, when free pages are > 25% of the file (and > 2 MB), `db.js` runs `VACUUM` (atomic) and `wal_checkpoint(TRUNCATE)`, logged "Database dipadatkan".
- **Backups.** `createBackup()` writes `VACUUM INTO` (a consistent, compact copy, safe while the server runs), verifies it (`integrity_check`), and removes the `-shm` / `-wal` files the check leaves; `pruneBackups()` removes them with the backup. Never go back to `db.backup()` (it copies free pages).
- **Old backups.** `compactOldBackups()` (1 s after start, background, one file at a time) rewrites each bloated backup with `VACUUM INTO`, checks it, keeps its date (retention unchanged) and replaces it. Content never changes; nothing is deleted.
- Tests: `server/test/volume-padat.test.js`.

---

## 44. Nomor & Tanggal Invoice Lock (`shared/invoiceNumbering.js`, `shared/invoiceDates.js`, `contractBilling.js` `nextInvoiceNumber`, `InvoiceDateField.jsx`)
- **One number format.** Setting > Aturan Booking > "Nomor & Tanggal Invoice": `invoiceNumberFormat` (tokens `{JENIS}` = EXP / DP / PL / FAC, `{TAHUN}`, `{BULAN}` in WIB, `{NOMOR}` = running number, min. 4 digits, required) and `invoiceNumberNext`. `invoiceFormatProblem()` validates it on the page and the server (400 `INVALID_NUMBER_FORMAT`).
  - Every invoice the application issues takes its number from `nextInvoiceNumber(kind)`: checkout (inside its transaction, nothing for a deferred Booking Manual), Buat Invoice, DP / Pelunasan / Penuh, facility. Never build an invoice number anywhere else.
  - The counter moves on with every number; taken numbers (deleted ones too, §31) are skipped.
  - `POST /invoices/config` changes the counter only from the top-level `invoiceNumberNext` (Setting sends it when the admin typed it). A page that saves the whole configuration with an older copy never moves it back.
  - A facility invoice is recognised by `invoice_kind` / id `inv_fac_*`, never by its number (the format is free).
- **Manual number.** Edit Invoice > "Nomor Invoice" (`PUT /invoices/:id { invoiceNumber }`): `cleanInvoiceNumber` (letters, digits, `/ . _ -`, 3–60 characters, no spaces; 400 `INVALID_INVOICE_NUMBER`), unique without case, deleted invoices included (409 `INVOICE_NUMBER_TAKEN`). The booking follows (`orders.invoice_number`). Audited "Ubah nomor invoice" (category `Invoice`, old → new).
- **Dates.** Tanggal Terbit = the day the invoice is opened / downloaded / printed (WIB); Jatuh Tempo = Tanggal Terbit + `invoiceDueDays` (Setting, default 14). `InvoiceA4View` computes both with `invoiceDates()` (also for the PDF and the WhatsApp text), never from the creation date.
  - Per invoice either date can be fixed by hand: `invoices.issue_date_fixed` / `due_date_fixed` = 1 uses the stored `issue_date` / `due_date`. New and existing invoices are automatic (0).
  - Forms use `InvoiceDateField` ("Otomatis" / "Tanggal tetap"): Edit Invoice, Buat Invoice (`InvoiceModal`), the DP / Pelunasan wizard (Jatuh Tempo). They send `issueDateFixed` / `dueDateFixed`.
- Tests: `server/test/nomor-invoice.test.js`.

---

## 45. Asisten WhatsApp Staf Lock (`routes/whatsappRoutes.js`, `utils/whatsapp.js`, `utils/waAgent.js`, `utils/waGemini.js`, `utils/geminiApi.js`)
- **What.** Sales, Keuangan and Super Admin send fixed COMMANDS over WhatsApp (text) and the system answers itself; any other message goes to the **Gemini agent** when it is set up (below). The commands never need AI (free and predictable) and keep working when Gemini is off, out of quota or down. Claude is not used here. Images / files are answered with "belum bisa dibaca"; voice notes are heard by Gemini (below).
  - **Commands** (`answerStaff`, case-insensitive, first word): `TERSEDIA [ukuran]` (Available booths without tenant, max 40, e.g. `TERSEDIA 3x3`), `BOOTH <nomor>` (detail via `boothSummary()`, never an email), `CARI <nama>` (tenant / booth), `RINGKASAN` (booths per status, invoices), `LUNAS` / `RESERVED` (booth numbers and tenants by payment, `paymentListText`), `BOOKING <nomor[, nomor]>`, `INVOICE <nomor booth | nomor invoice>` (an invoice that exists: its PDF at once, no YA, `sendInvoicePdfs`; none yet: the first invoice is prepared and waits for YA). Anything else answers `MENU` (the list). The project is the latest published floorplan (`currentProject`).
  - **Booth numbers may contain spaces** ("UH 13 14", "ST 5/6", "20 - 29"): `boothCodesFrom` tries the whole text as one number first, then a list split by commas or spaces.
  - **BOOKING asks one question at a time** (`BOOKING_STEPS`: brand, PIC, tenant WhatsApp 8–15 digits, brand category, plan `PENUH` / `DP <1–99>`; a wrong answer re-asks), kept per staff member in RAM for 10 minutes. While it runs every message is the answer, `BATAL` stops it. Super Admin and Sales only (`CAN_BOOK` = `canRegisterTenant` for these roles); the booths must be Available without tenant, checked at the start and again at the end.
  - **Nothing is saved before YA.** A finished booking and `INVOICE` (all three roles; Invoice DP when the booking's plan is DP, else Penuh) only PREPARE a request: the system sends a summary ending in "Balas YA untuk menyimpan atau BATAL. Berlaku 10 menit." The next "ya" / "iya" / "yes" saves it, "batal" / "tidak" drops it; a YA without a pending request or after 10 minutes saves nothing.
  - **Saving = the web endpoints, in that staff member's name** (`runConfirmed`): a short session of the user (`createSession`, deleted afterwards) calls `POST /orders/checkout` (Booking Manual: `deferInvoice`, plan Bayar Penuh / DP %, note "Dibuat via WhatsApp") or `POST /booth-actions/invoice`. So role rules, "booth sudah diambil", "sudah punya invoice" and the audit log are the web's own; an extra entry "Booking / Buat invoice via WhatsApp" (category `WhatsApp`) is written.
  - **Invoice PDF**: after the invoice, the reply is the number, total and due date (`invoiceDates`, §44), then the PDF from `GET /invoices/:id/pdf` (same session) sent as a FILE upload (`sendFile`, multipart `file`, no public link). Fonnte allows files on its Super / Advanced / Ultra packages (max 4 MB); otherwise its reason is sent as text. Without a PDF engine the reason is sent as text and the invoice number still arrives.
- **Gemini agent** (the owner asked for it; spec `docs/superpowers/specs/2026-10-29-whatsapp-gemini-design.md`). It reads data and PREPARES bookings / invoices; it never saves, never gives discounts, never changes payment status.
  - **Routing** (`answerStaff`): a booking being asked and YA / BATAL with a waiting request stay with the system. A command is answered by the system only when its argument is understood (`isCommand`: MENU / RINGKASAN alone, TERSEDIA [ukuran], BOOTH / INVOICE <existing booth>, BOOKING <existing booths>, CARI ≤ 3 words); everything else goes to Gemini when `geminiReady()` (key present and not switched off), else MENU. "ya" without a waiting request goes to Gemini.
  - **Tools** (`READ_TOOLS` + `ACTION_TOOLS` in `waAgent.js`): `booth_tersedia`, `detail_booth`, `cari_tenant`, `ringkasan_project` (the same readers as the commands), `daftar_booth` (`paymentListText` by `status`: `lunas` (+ Sold booths without an invoice, called out), `reserved` = `dp` + `belum_bayar` + `belum_ditagih`, or `semua`; from `getContract()` per booked booth, the same contract status as the Dashboard, §14; max 60 lines per group), `cari_invoice` (`invoiceListText`: invoices by booth number, invoice number or tenant name, with kind, total and payment status, or "belum ada invoice"), `kirim_pdf_invoice` (`sendInvoicePdfs`: the PDF of invoices that already exist, max 3, canceled ones left out; no YA because nothing is saved; `{ parts }` ends the turn with the system's own message), `siapkan_booking` / `siapkan_invoice` (the same `bookingRequest()` / `invoiceRequest()` as BOOKING / INVOICE, incl. `CAN_BOOK`). Invoices are matched as in §12: exact number or one part of a merged code, never a substring. A PDF always comes from `GET /invoices/:id/pdf` with a short session of the asking staff member (`withSession` + `pdfParts`): WhatsApp gets the file, the chat in Setting a download button. A successful `siapkan_*` ends the turn with the SYSTEM's own confirmation text (`{ final }`); Gemini never words a confirmation. A refusal goes back to Gemini as data (`{ error }`). Never give Gemini a tool that saves.
  - **Loop** (`chatWithGemini`, REST `generateContent` through `fetch`, no SDK): the model's content is sent back exactly as received within a turn (Gemini 3 thought signatures, 400 otherwise); one `functionResponse` with the call's `id` and `name` per call; max 5 steps. Memory: the last 12 text messages per staff member in RAM, dropped after 30 idle minutes. `**bold**` becomes WhatsApp `*bold*`. A failure (key refused, quota 429, outage) answers its Indonesian reason + "ketik MENU".
  - **Setting > Integrasi WhatsApp > "Agen AI (Gemini)"** (`GeminiAgentSettings.jsx`, `/api/maintenance/whatsapp/gemini`, Super Admin only like the rest of the page): the key (`GEMINI_API_KEY`, from Google AI Studio; new "auth keys" since 28 May 2026 look like `AQ.…` with dots, older ones `AIza…`, both accepted by `isValidGeminiKeyFormat`) is WRITE-ONLY in the env file (`/data/.env` on Railway), checked with `GET /v1beta/models` first (refused / no permission = 400, nothing stored; a 403 is an unrestricted standard key: the message tells how to restrict it in AI Studio, with Google's own reason; network / quota / outage = stored with a warning); status shows its last 4 characters only; a key from the real environment cannot be changed there. Model dropdown (`/gemini/models`, default `gemini-3.5-flash`: a fixed model, never the alias `gemini-flash-latest`, which once hung 90 s with no answer); one call waits at most 20 s (`GEMINI_TIMEOUT_MS`). A turn that fails on the model itself (503 "high demand", no answer, 404, quota) is run once more, from the start, on `FALLBACK_GEMINI_MODEL` (`gemini-3.1-flash-lite`; the default when that one is chosen); only when both fail is the staff member told to retry or pick another model, on / off, delete, and **"Chat dengan asisten"** (`POST /api/maintenance/whatsapp/chat { message }` → `{ parts }`): the assistant on the page, exactly as on WhatsApp for the logged-in Super Admin (`answerStaff(user, text, WEB_CHANNEL)`: commands, Gemini, booking / invoice saved only after YA, quick buttons "Ya, simpan" / "Batal"). The request records its channel: the booking note says "Dibuat via chat Setting" and the audit entry "Booking / Buat invoice via chat Setting"; an issued invoice comes back as `{ invoiceId, invoiceNumber, filename }` and is downloaded through `downloadInvoicePdf` (no PDF is rendered for the chat itself). Model / on-off live in `maintenance_settings.wa_meta.gemini`. Saving / deleting is audited (category `Maintenance`) without the value. `GEMINI_API_URL` points tests at a mock; tests and staging set `GEMINI_API_KEY=''`.
  - **Voice notes** (`incomingMessage` type `audio` by extension: ogg / opus / mp3 / m4a / aac / wav / webm / flac → `AUDIO_TYPES`; `answerVoice` in `waAgent.js`): the file at Fonnte's `url` is downloaded (`downloadAudio`: http(s), max 10 MB, 20 s), Gemini only LISTENS (`transcribeAudio`: inline audio, no tools, 45 s, same fallback model; "(tidak terdengar)" = nothing intelligible), and the text goes through `answerStaff` like a typed message (commands, YA / BATAL, booking questions). The reply starts with `🎙️ Kakak bilang: "…"`, so a spoken "ya" that saves something is visible. Fonnte forwards the file only on packages with attachments ("all feature"); without `url`, without Gemini, or unintelligible, the staff member is asked politely to type. The audio is never stored.
  - **A text without any letter, digit or emoji** (empty, spaces, invisible characters) is type `empty`, never sent to Gemini, and answered "pesan ini tidak berisi teks … paket Fonnte … mohon diketik". Seen in production: on the Free package a voice note arrives as such a text, with no `url` / `extension` (Gemini then answered "pesan kosong").
  - **"Pesan masuk terakhir"** (`wa_meta.lastIncoming`, shown in Setting): time, kind (teks / suara / lampiran), extension, whether a file came, masked sender (`…1234`) and staff name, and the outcome (answered; not a staff number; Fonnte refused the reply, e.g. "disconnected device"; voice note without file …), the field names Fonnte sent (`fields`) and, for a text that cannot be read, its code points (`textCodes`, e.g. `U+200E`). Never readable message text.
  - **Persona** (the owner's brief, 2026-10-29): a polite muslimah virtual admin, "Kak Aisyah" by default; Setting > Integrasi WhatsApp > "Nama asisten" picks `PERSONAS` (Aisyah, Khadijah / Kak Dijah, Zahra, Nadhira, Salma; `wa_meta.persona`). Used in the Gemini prompt (calls staff "Kak", says "saya", answers salam, modest Islamic phrases, no politics / SARA / gossip / flirting / promises it cannot keep, refuses improper requests politely), in MENU ("Assalamu'alaikum, Kak 😊 Saya Aisyah, admin yang siap membantu") and in the apologies. Booking / invoice confirmations stay plain.
    - **What it says about itself** (owner, 2026-10-30): it never calls itself a bot, chatbot, AI or "virtual", and never tells the person on WhatsApp about quota, tokens, models or services. Every failure there is a neutral apology (`neutralApology`, voice notes `notNow`, files "belum bisa … buka / terima"); the technical reason goes to "Pesan masuk terakhir" (`takeFailure` → outcome "tidak bisa dijawab: …", voice outcomes) and stays visible in the chat in Setting. **But it never claims to be human**: asked sincerely whether it is a person or a machine, it says honestly that it is the team's automated assistant (prompt rule "jangan mengaku manusia"). Do not remove that rule.
    - **The prompt starts with the data rules** ("WAJIB memanggil alat", never a booth, name or number that is not in a tool result): with the persona first, a greeting once made the model list booths that do not exist. Keep that order.
  - **Privacy**: Gemini's free tier lets Google use the prompts (tenant names, PIC phones) to improve its products; the page says so and recommends billing on the key's Google project.
- **Channel: Fonnte** (https://fonnte.com, a WhatsApp gateway on the office number; not Meta's official API, so the number can be blocked: use a dedicated number). Webhook `POST /api/whatsapp/webhook/<FONNTE_WEBHOOK_SECRET>` (`public` in `ACCESS_RULES`). Fonnte does not sign its calls, so the secret in the URL is the lock (`secretMatches`, constant time; a wrong or missing secret = 404, nothing processed). The call is answered 200 at once (Fonnte retries 15 times otherwise); the reply goes out with `POST https://api.fonnte.com/send { target, message }` and the header `Authorization: <token>` (no Bearer). Secrets only in `server/.env`: `FONNTE_TOKEN`, `FONNTE_WEBHOOK_SECRET`, optional `FONNTE_DEVICE` (the connected number: calls of other devices and messages from itself are ignored). `FONNTE_API_URL` points the tests at a mock. Groups (`member` set) are ignored; a message with an attachment (`url` / `extension`) or without text is "non-text".
- **Message signature** ("Tanda tangan di akhir pesan", Setting > Integrasi WhatsApp; `wa_meta.signature`, one line, max 80 characters, `''` = none): `withSignature()` in `whatsapp.js` appends it after a blank line to every WhatsApp text and file caption (also the test message), not to the chat in Setting. "Sent via fonnte.com" is added by Fonnte itself on its Free package, after the message leaves the server: it cannot be removed or replaced by the application, only by a paid Fonnte package. A token from the real environment locks only the token, not the device / signature.
- **Who is answered.** Only an ACTIVE `users` row with role `superadmin` / `finance` / `sales` whose `phone` equals the sender (`normalizePhone`: 0812… = +62 812… = 62812…; Fonnte's `sender` is digits with 62); a number shared by two accounts is refused. Every other number gets NO reply (nothing is revealed). Tenants and the public never use it. Max 20 messages per sender per 10 minutes; Fonnte retries are ignored by `inboxid` (or sender + timestamp + text).
- **Setting > Integrasi WhatsApp** (`FonnteSettings.jsx`, `routes/whatsappSettingsRoutes.js`, `/api/maintenance/whatsapp`, `access: []` = Super Admin only, audited in category `Maintenance` without values). Same rules as the Claude key (§23): the token is WRITE-ONLY (status returns `tokenConfigured` + last 4 characters), stored in the env file through `setEnvFileValue` (validated: no spaces / quotes / line breaks) and applied at once. **On Railway the env file is `ENV_FILE=/data/.env` (on the Volume)**: `server/.env` lives on the container disk, which every deploy discards, so a token (or the Claude key, §23) saved there was lost at the next deploy; a token set in the real environment (Railway Variables) cannot be changed or deleted there. Saving a token also creates `FONNTE_WEBHOOK_SECRET` (24 random bytes, hex) when missing; "Ganti" makes a new one and the old URL dies. The page shows the webhook URL to paste into Fonnte (the secret is part of it, so only the Super Admin sees it), "Kirim pesan tes" (sends one message and so proves the token; Fonnte's `reason` is shown on failure) and which staff accounts have a phone number.
- Tests: `server/test/whatsapp.test.js` (security, reading commands), `server/test/whatsapp-tahap2.test.js` (booking, invoice, YA / BATAL, PDF), `server/test/whatsapp-settings.test.js` and `server/test/whatsapp-gemini.test.js` (agent, tools, YA, role, failure and fallback model, key settings, web chat booking + invoice, voice notes, persona). Fonnte and Gemini are local mocks.

---

## 46. Menu Fasilitas Lock (`facilityRoutes.js`, `FacilityRequestsPage.jsx`, `invoiceRoutes.js` delete / restore)
- **Who.** Super Admin, Keuangan, **Sales, Operasional and the role Fasilitas (`facility`)** use the whole Fasilitas menu: forms (create, edit, delete, templates), requests, status changes, "Terbitkan Invoice" of a request, broadcast to tenants and the tenant facility form (`PAGE_ACCESS.facilities`; server: one rule `GET` + writes on `/facilities/*` for Finance, Sales, Operations, and `/facilities` in `OPERATIONS_AREA`). The tenant portal (`GET /facilities/forms…`, `POST /facilities/requests/submit`) stays public.
- **Role `facility`** sees only this menu (`PAGE_ACCESS.facilities`, `HOME_PAGE`) and reaches only `FACILITY_AREA` in `auth.js` (`/facilities`, notifications, chat, its own account): every other endpoint is 403, on public endpoints it is a visitor (like `developer`). It issues and cancels facility invoices from this menu but cannot open invoice pages or PDFs. `users.role` has a CHECK list: a new role means widening it in `db.js` (the rebuild keeps foreign keys off, DROP TABLE would otherwise cascade into `sessions`, and copies the database first).
- **Tenant list without billing data.** "Broadcast ke Tenant" and "Form Fasilitas Tenant" read `GET /api/facilities/tenants?projectId=<id | global>` (`api.fetchFacilityTenants`): booked (reserved / sold) booths with a tenant, with project, booth, tenant, PIC and phone only. They never call `/stats` again: the Dashboard (prices, revenue) stays closed to Operations.
- **A deleted facility invoice rejects its request.** `DELETE /api/invoices/:id` of a `facility` invoice (§31) sets its `facility_requests` row (`invoice_id`) to `REJECTED` in the same transaction; restoring it from the Tempat Sampah sets the request back to `INVOICED`. Other requests are never touched.
- **"Total Pendapatan Fasilitas"** sums the requests that are not `REJECTED`.
- **Item categories: one managed list** (`GET` / `PUT /api/facilities/categories`, `POST /api/facilities/categories/rename`; stored in `maintenance_settings.facility_categories`, the 9 built-in names until it is first changed). "Kelola Kategori" (`FacilityCategoryManager.jsx`, from the item list and from the item form) adds, renames and deletes every name, the built-in ones included. Rename = the list AND every item of every saved form / template, in one transaction (tenant requests already sent keep what they ordered); delete = only out of the list, items keep their category (the window shows how many items use each name). Max 50 names, 1–60 characters, no duplicates ignoring case (400 / 409 `CATEGORY_EXISTS`). The item form's Kategori is a dropdown of the list (an item's old category not in the list is shown as "(tidak ada di daftar)") with "+ Buat kategori baru…" to type a new name, which joins the list when the item is saved. "Kelola Kategori & Item" opens each category to the items of the form being edited (edit / delete / "+ Tambah item ke …" with the category preset; categories that exist only on items are listed with "Tambah ke daftar"), and shows "Simpan formulir" while item changes are unsaved; the item form opens above it (`z-[70]`). Audited in category `Fasilitas`. The tenant portal and the A4 form group / print by the item's own category.
- **Tenant portal `/facility-request`** (`PublicFacilityRequestPage.jsx`): light layout, steps Data booth → Pilih fasilitas → Catatan, 16 px inputs on phones (no iOS zoom), a fixed bottom bar with the total and "Kirim" below `lg`. **The submission receipt is the existing A4 template** (`FacilityFormA4View mode="filled"`, `docNumber` = request id) printed through `printInvoiceElement('printable-facility-form-a4')`. Never call `window.print()` on a page without a `printable-*` sheet: the global print CSS hides everything else, so it printed a blank page.
- **"Batalkan Invoice" (`POST /api/facilities/requests/:id/cancel-invoice { reason, outcome, confirmNumber }`, `FacilityInvoiceCancelModal.jsx`).** Who: the Fasilitas menu roles; an invoice with a payment: Super Admin only, after typing its number (409 `INVOICE_PAID`, 400 `CONFIRM_NUMBER`). The reason is mandatory (`DELETE_REASON_MIN`). The invoice stays on record as `CANCELED` (never the trash; its number is never reused; `paid_amount` is kept), audited in category `Fasilitas`. `outcome: 'rejected'` (tenant tidak jadi) = request `REJECTED`, `invoice_id` kept; `outcome: 'change'` (ada perubahan) = request `APPROVED`, `invoice_id` cleared, and the "Ubah" window opens. Canceling in Manajemen Invoice (`POST /invoices/:id/status`) also rejects the request; activating it again sets `INVOICED`.
- **"Ubah" a request (`PUT /api/facilities/requests/:id { items, notes }`, `FacilityRequestEditModal.jsx`)**: refused while it has a live invoice (409 `REQUEST_INVOICED`), the total is computed by the server. `generate-invoice` also answers 409 `REQUEST_INVOICED` when a live invoice exists: one request, one live invoice. "Buka Lagi" sets a rejected request without a live invoice back to `PENDING`. `GET /facilities/requests` carries `invoice` ({ id, number, status, total, paid }).
- **"Hapus" a request** (`DELETE /api/facilities/requests/:id`, Trash2 button at the end of AKSI, confirmation with "Batal" focused): soft delete (`deleted_at` / `deleted_by`), the list hides it, "Urungkan" for 5 seconds (`POST /api/facilities/requests/:id/restore`). Refused while it has a live invoice (409 `REQUEST_INVOICED`: "Batalkan Invoice" first); a canceled invoice stays on record. Audited "Hapus / Pulihkan pengajuan fasilitas" (category `Fasilitas`).
- **"Cetak PDF" per request** (`handleRequestPdf` in `FacilityRequestsPage.jsx`): the request as it was submitted (`mode="filled"`, its own items, `docNumber` = request id, its form's title, the tenant's note as `tenant.notes`), downloaded through `downloadFacilityFormPdf`; without Chromium an off-screen sheet goes to the print dialog. "Form & WA" (the old "Form PDF") still opens the form modal for that tenant.
- **The A4 facility form** (`FacilityFormA4View`, used for the admin "Form Fasilitas Tenant" the portal receipt and "Cetak PDF" of a request):
  - The organizer block ("Diterbitkan oleh") and the centred header show the company name and address only: no phone, email or website (the owner's choice).
  - **Kop surat**: the letterhead of Desain Layout Invoice (`letterheadUrl`, §42) is the background of the whole sheet (`<img data-kop-bg>`, `z-index: -1`, sheet `isolation: isolate`). It is fixed when printed, so it is on every page.
  - **More than one page**: the content sits in a table whose empty head / foot rows (12 mm top; bottom 12 mm, or 38 mm with a letterhead so its footer logo / address stay free) are repeated by the browser on every page. Item rows, the total and the signature block are never split. The sheet is marked `data-print-pages`; `printInvoiceElement` then undoes its one-page rules (fixed 297 mm, clipped). It used to cut a long form off after page 1.
  - **"Download PDF A4" (and "Kirim via WhatsApp") = the server**: `POST /api/facilities/form-pdf { tenant, form, items, mode, docNumber }` (staff of the Fasilitas menu, nothing stored) renders `/print/facility-form` (`FacilityFormPrintPage`, payload `window.__FACILITY_PRINT__`) with the saved invoice design through `renderFacilityFormPdf` (same engine and queue as the invoice, §34). Client: `downloadFacilityFormPdf()` in `utils/invoicePdf.js`. Without Chromium (503) the modal opens the print dialog instead. The old html2canvas download always failed on Tailwind v4's `oklch()` colours.
- Tests: `server/test/fasilitas.test.js`.
