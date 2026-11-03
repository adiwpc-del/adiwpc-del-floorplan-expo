import React, { useState, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  Send, 
  ExternalLink, 
  FileText, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  AlertCircle, 
  Layers, 
  Search, 
  Copy, 
  Sparkles, 
  RotateCcw, 
  ChevronRight,
  DollarSign,
  Package,
  Calendar,
  Eye,
  Check,
  Building2,
  Phone,
  MessageSquare,
  Tags,
  Printer,
  Ban
} from 'lucide-react';
import { api } from '../../services/api';
import BroadcastTenantModal from '../../components/admin/BroadcastTenantModal';
import GenerateTenantFacilityModal from '../../components/admin/GenerateTenantFacilityModal';
import FacilityCategoryManager from '../../components/admin/FacilityCategoryManager';
import FacilityFormA4View from '../../components/admin/FacilityFormA4View';
import FacilityInvoiceCancelModal from '../../components/admin/FacilityInvoiceCancelModal';
import FacilityRequestEditModal from '../../components/admin/FacilityRequestEditModal';
import { downloadFacilityFormPdf } from '../../utils/invoicePdf';
import { printInvoiceElement } from '../../utils/invoicePrintUtils';

export default function FacilityRequestsPage() {
  const [activeTab, setActiveTab] = useState('requests'); // 'requests' | 'builder'
  const [requests, setRequests] = useState([]);
  const [forms, setForms] = useState([]);
  const [activeForm, setActiveForm] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState('');
  const [isBroadcastModalOpen, setIsBroadcastModalOpen] = useState(false);
  const [isGenerateTenantModalOpen, setIsGenerateTenantModalOpen] = useState(false);
  const [selectedTenantForModal, setSelectedTenantForModal] = useState(null);
  const [pdfRequestId, setPdfRequestId] = useState(null);
  const [cancelInvoiceRequest, setCancelInvoiceRequest] = useState(null);
  const [editRequest, setEditRequest] = useState(null);
  const [printSheet, setPrintSheet] = useState(null); // off-screen A4 sheet, only when the server has no PDF engine

  // Requests filtering
  const [searchRequest, setSearchRequest] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Builder form state
  const [builderForm, setBuilderForm] = useState({
    id: '',
    title: 'Formulir Permintaan Fasilitas Tambahan Expo 2026',
    description: 'Silakan pilih kebutuhan fasilitas tambahan untuk booth pameran Anda.',
    event_title: 'Indonesia International Expo 2026',
    deadline_date: '2026-10-05',
    terms_notes: '1. Pengajuan paling lambat H-10 sebelum pelaksanaan expo.\n2. Invoice resmi akan diterbitkan setelah pesanan dikonfirmasi.',
    is_active: 1,
    items: []
  });

  const [editingItemIdx, setEditingItemIdx] = useState(null);
  // Item form: pick an existing category, or "+ Buat kategori baru" to type one
  const [newCategoryMode, setNewCategoryMode] = useState(false);
  // Items changed (added / edited / deleted) but the form is not saved yet
  const [itemsDirty, setItemsDirty] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  // Item categories: one list for every form, kept on the server (AGENTS.md §46)
  const [categories, setCategories] = useState([]);
  const [categoryUsage, setCategoryUsage] = useState({});
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [itemDraft, setItemDraft] = useState({
    id: '',
    name: '',
    category: 'Listrik & Pencahayaan',
    unit: 'Unit',
    price: 150000,
    max_qty: 10,
    description: ''
  });

  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [saveAsTemplateModalOpen, setSaveAsTemplateModalOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [allForms, allReqs, cats] = await Promise.all([
        api.fetchFacilityForms(),
        api.fetchFacilityRequests(),
        api.facilityCategories()
      ]);
      if (cats?.success) { setCategories(cats.categories || []); setCategoryUsage(cats.usage || {}); }

      setForms(allForms || []);
      setRequests(allReqs || []);

      const tpls = allForms.filter(f => f.is_template);
      setTemplates(tpls);

      const liveActive = allForms.find(f => f.is_active && !f.is_template) || allForms.find(f => !f.is_template) || allForms[0];
      if (liveActive) {
        setActiveForm(liveActive);
        setBuilderForm({
          id: liveActive.id,
          title: liveActive.title || '',
          description: liveActive.description || '',
          event_title: liveActive.event_title || '',
          deadline_date: liveActive.deadline_date || '',
          terms_notes: liveActive.terms_notes || '',
          is_active: liveActive.is_active ? 1 : 0,
          items: liveActive.items || []
        });
      }
    } catch (e) {
      console.error('Error loading facilities data:', e);
      showToast('⚠️ Gagal memuat data formulir fasilitas');
    } finally {
      setLoading(false);
    }
  };

  // Status Change Handler
  const handleStatusChange = async (reqId, newStatus) => {
    try {
      const res = await api.updateFacilityRequestStatus(reqId, newStatus);
      if (res && res.success) {
        showToast(`✅ Status pengajuan diubah menjadi ${newStatus}`);
        loadAllData();
      }
    } catch (e) {
      showToast('⚠️ Gagal mengubah status pengajuan');
    }
  };

  // One request as PDF: the same A4 template as the tenant's receipt (AGENTS.md §46), filled with what was ordered
  const handleRequestPdf = async (req) => {
    if (pdfRequestId) return;
    setPdfRequestId(req.id);
    const sheet = {
      tenant: { boothCode: req.booth_code, companyName: req.company_name, picName: req.pic_name, phone: req.phone, email: req.email, notes: req.notes },
      form: forms.find(f => f.id === req.form_id) || {},
      items: req.items || [],
      mode: 'filled',
      docNumber: req.id
    };
    const namePart = (v) => String(v || '').replace(/[^a-zA-Z0-9_-]+/g, '_');
    try {
      const result = await downloadFacilityFormPdf({ ...sheet, fileName: `Pengajuan_Fasilitas_${namePart(req.booth_code)}_${namePart(req.company_name)}.pdf` });
      if (result.success) {
        showToast('📄 PDF pengajuan fasilitas berhasil diunduh');
      } else if (result.unavailable) {
        showToast('PDF belum bisa dibuat server. Pilih "Simpan sebagai PDF" di dialog cetak.');
        flushSync(() => setPrintSheet(sheet));
        await printInvoiceElement('printable-facility-form-a4');
      } else {
        showToast(`⚠️ ${result.error}`);
      }
    } finally {
      setPrintSheet(null);
      setPdfRequestId(null);
    }
  };

  // Generate Invoice Handler
  const handleGenerateInvoice = async (reqId) => {
    if (!confirm('Terbitkan invoice resmi A4 untuk pesanan fasilitas tambahan ini?')) return;
    try {
      const res = await api.generateFacilityInvoice(reqId);
      if (res && res.success) {
        showToast(`📄 ${res.message || 'Invoice resmi berhasil diterbitkan!'}`);
        loadAllData();
      } else {
        showToast(`⚠️ ${res.message || 'Gagal menerbitkan invoice'}`);
      }
    } catch (e) {
      showToast('⚠️ Gagal menerbitkan invoice');
    }
  };

  // Save Form Handler
  const handleSaveForm = async () => {
    if (!builderForm.title.trim()) {
      showToast('⚠️ Judul formulir tidak boleh kosong');
      return;
    }
    if (builderForm.items.length === 0) {
      showToast('⚠️ Tambahkan minimal 1 item fasilitas pada formulir');
      return;
    }

    try {
      const payload = {
        ...builderForm,
        is_template: 0,
        is_active: 1
      };
      const res = await api.saveFacilityForm(payload);
      if (res && res.success) {
        showToast('✅ Formulir fasilitas berhasil disimpan dan diaktifkan!');
        setItemsDirty(false);
        loadAllData();
      }
    } catch (e) {
      showToast('⚠️ Gagal menyimpan formulir');
    }
  };

  // Save as Template Handler
  const handleSaveAsTemplate = async () => {
    if (!newTemplateName.trim()) {
      showToast('⚠️ Nama template wajib diisi');
      return;
    }

    try {
      const payload = {
        ...builderForm,
        id: `tpl_custom_${Date.now()}`,
        is_template: 1,
        is_active: 0,
        template_name: newTemplateName.trim()
      };
      const res = await api.saveFacilityForm(payload);
      if (res && res.success) {
        showToast(`🎨 Template "${newTemplateName}" berhasil disimpan!`);
        setSaveAsTemplateModalOpen(false);
        setNewTemplateName('');
        loadAllData();
      }
    } catch (e) {
      showToast('⚠️ Gagal menyimpan template');
    }
  };

  // Apply Template Handler
  const handleApplyTemplate = (tpl) => {
    setBuilderForm(prev => ({
      ...prev,
      title: tpl.title || prev.title,
      description: tpl.description || prev.description,
      terms_notes: tpl.terms_notes || prev.terms_notes,
      items: JSON.parse(JSON.stringify(tpl.items || []))
    }));
    setIsTemplateModalOpen(false);
    showToast(`✨ Template "${tpl.template_name || tpl.title}" berhasil diterapkan ke editor!`);
  };

  // Item Management inside Builder
  const handleOpenItemModal = (item = null, idx = null, presetCategory = '') => {
    setNewCategoryMode(false);
    if (item && idx !== null) {
      setItemDraft({ ...item });
      setEditingItemIdx(idx);
    } else {
      setItemDraft({
        id: `item_${Date.now()}`,
        name: '',
        category: presetCategory || categories[0] || 'Lainnya',
        unit: 'Unit',
        price: 150000,
        max_qty: 10,
        description: ''
      });
      setEditingItemIdx(null);
    }
    setItemModalOpen(true);
  };

  // The managed list (Kelola Kategori); a name typed on an item joins it when the item is saved
  const categoryOptions = categories;

  // After "Kelola Kategori": the new list, and a renamed category follows in the form being edited (the server already
  // renamed it in every saved form and template)
  const handleCategoriesChanged = (res, change) => {
    setCategories(res.categories || []);
    setCategoryUsage(res.usage || {});
    const renamed = change?.renamed;
    if (!renamed) return;
    const follow = (items) => (Array.isArray(items) ? items : []).map(i => (String(i.category || '').trim() === renamed.from ? { ...i, category: renamed.to } : i));
    setBuilderForm(prev => ({ ...prev, items: follow(prev.items) }));
    setForms(prev => prev.map(f => ({ ...f, items: follow(f.items) })));
    setItemDraft(prev => (String(prev.category || '').trim() === renamed.from ? { ...prev, category: renamed.to } : prev));
    showToast(`Kategori "${renamed.from}" diganti menjadi "${renamed.to}"${res.updatedItems ? ` (${res.updatedItems} item ikut berubah)` : ''}`);
  };

  const handleSaveItem = () => {
    if (!itemDraft.name.trim()) {
      showToast('⚠️ Nama fasilitas wajib diisi');
      return;
    }
    const saved = { ...itemDraft, category: String(itemDraft.category || '').trim().replace(/\s+/g, ' ') || 'Lainnya' };
    if (!categories.some(c => c.toLowerCase() === saved.category.toLowerCase())) {
      // a new category typed on the item joins the list
      api.facilityCategories('PUT', '', { categories: [...categories, saved.category] }).then(res => { if (res?.success) handleCategoriesChanged(res); });
    }

    setBuilderForm(prev => {
      const items = [...prev.items];
      if (editingItemIdx !== null) {
        items[editingItemIdx] = saved;
      } else {
        items.push({ ...saved, id: saved.id || `item_${Date.now()}` });
      }
      return { ...prev, items };
    });

    setItemModalOpen(false);
    setItemsDirty(true);
    showToast(editingItemIdx !== null ? 'Item fasilitas diperbarui' : 'Item fasilitas ditambahkan');
  };

  const handleDeleteItem = (idx) => {
    setBuilderForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx)
    }));
    setItemsDirty(true);
    showToast('🗑️ Item fasilitas dihapus');
  };

  // Calculation for stats
  const totalReqCount = requests.length;
  const pendingCount = requests.filter(r => r.status === 'PENDING').length;
  const invoicedCount = requests.filter(r => r.status === 'INVOICED').length;
  // A rejected request (also one whose facility invoice was deleted, §46) is no revenue
  const totalRevenue = requests.filter(r => r.status !== 'REJECTED').reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0);

  const filteredRequests = requests.filter(r => {
    const matchStatus = statusFilter === 'ALL' || r.status === statusFilter;
    const q = searchRequest.toLowerCase().trim();
    const matchSearch = !q || 
      (r.booth_code && r.booth_code.toLowerCase().includes(q)) ||
      (r.company_name && r.company_name.toLowerCase().includes(q)) ||
      (r.pic_name && r.pic_name.toLowerCase().includes(q));
    return matchStatus && matchSearch;
  });

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto w-full space-y-6">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900/95 text-white px-4 py-2.5 rounded-xl border border-slate-700 shadow-2xl flex items-center gap-2 text-xs animate-fadeIn">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
              Formulir Permintaan Fasilitas Tambahan
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold">
              Add-on Manager
            </span>
          </div>
          <p className="text-slate-500 text-xs mt-1">
            Kelola katalog fasilitas sewaan (listrik, meja, kursi, spotlight), rancang template formulir, dan distribusikan ke seluruh exhibitor.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2.5">
          <a
            href="/facility-request"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-slate-300 shadow-xs cursor-pointer"
            title="Lihat Tampilan Formulir Sisi Tenant"
          >
            <ExternalLink size={14} />
            <span>Lihat Form Publik</span>
          </a>

          <button
            type="button"
            onClick={() => {
              setSelectedTenantForModal(null);
              setIsGenerateTenantModalOpen(true);
            }}
            className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 shadow-xs cursor-pointer"
            title="Buat Lembar Formulir PDF Resmi dengan Kop Surat Perusahaan & Kirim via WhatsApp Web"
          >
            <FileText size={14} className="text-slate-500" />
            <span>Buat Form PDF & WA Tenant</span>
          </button>

          <button
            type="button"
            onClick={() => setIsBroadcastModalOpen(true)}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 shadow-xs cursor-pointer"
          >
            <Send size={14} />
            <span>Kirim ke Semua Tenant</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Package size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 block uppercase">Total Pengajuan</span>
            <span className="text-xl font-black text-slate-800">{totalReqCount}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Clock size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 block uppercase">Perlu Verifikasi</span>
            <span className="text-xl font-black text-amber-600">{pendingCount}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <FileText size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 block uppercase">Diterbitkan Invoice</span>
            <span className="text-xl font-black text-blue-600">{invoicedCount}</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <DollarSign size={20} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 block uppercase">Total Pendapatan Fasilitas</span>
            <span className="text-base font-black font-mono text-emerald-600">
              Rp {totalRevenue.toLocaleString('id-ID')}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('requests')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'requests'
                ? 'bg-slate-900 text-white shadow-md'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Package size={14} />
            <span>Pengajuan Masuk ({requests.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('builder')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'builder'
                ? 'bg-slate-900 text-white shadow-md'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Layers size={14} />
            <span>Kelola Formulir & Template ({builderForm.items.length} Item)</span>
          </button>
        </div>

        {activeTab === 'builder' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsTemplateModalOpen(true)}
              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg border border-indigo-200 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Sparkles size={13} />
              <span>Pilih dari Template ({templates.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setSaveAsTemplateModalOpen(true)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Save size={13} />
              <span>Simpan sebagai Template Baru</span>
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: REQUESTS LIST */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              {['ALL', 'PENDING', 'APPROVED', 'INVOICED', 'COMPLETED', 'REJECTED'].map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    statusFilter === st
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {st === 'ALL' ? 'Semua Status' : st}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Cari booth / perusahaan / PIC..."
                value={searchRequest}
                onChange={(e) => setSearchRequest(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Requests Table */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            {filteredRequests.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs">
                <Package size={32} className="mx-auto text-slate-300 mb-2" />
                <p className="font-semibold text-slate-600">Belum Ada Pengajuan Fasilitas Tambahan</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Bagikan formulir ke exhibitor menggunakan tombol "Kirim ke Semua Tenant".
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-3.5 px-4">Booth & Tenant</th>
                    <th className="py-3.5 px-4">PIC & Kontak</th>
                    <th className="py-3.5 px-4">Item Fasilitas Dipesan</th>
                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Total Tagihan</th>
                    <th className="py-3.5 px-4 text-center">Status</th>
                    <th className="py-3.5 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRequests.map((req) => {
                    const items = req.items || [];
                    const isPending = req.status === 'PENDING';
                    const isInvoiced = req.status === 'INVOICED';
                    const liveInvoice = req.invoice && req.invoice.status !== 'CANCELED' ? req.invoice : null;
                    const isOpen = !liveInvoice && !isInvoiced && req.status !== 'REJECTED' && req.status !== 'COMPLETED';

                    return (
                      <tr key={req.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 text-[11px] whitespace-nowrap shrink-0">
                              {req.booth_code}
                            </span>
                            <span className="font-bold text-slate-900 text-xs">{req.company_name}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            Diajukan: {req.created_at ? new Date(req.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-800 block">{req.pic_name}</span>
                          <span className="text-[11px] text-slate-500 font-mono">{req.phone || '-'}</span>
                        </td>

                        <td className="py-3 px-4 max-w-xs">
                          <div className="space-y-1">
                            {items.slice(0, 3).map((it, i) => (
                              <div key={i} className="text-[11px] text-slate-600 flex items-center justify-between">
                                <span className="truncate pr-2">• {it.name}</span>
                                <span className="font-semibold text-slate-800 shrink-0">x{it.qty}</span>
                              </div>
                            ))}
                            {items.length > 3 && (
                              <span className="text-[10px] text-indigo-600 font-semibold block">
                                + {items.length - 3} item lainnya
                              </span>
                            )}
                            {req.notes && (
                              <p className="text-[10px] text-slate-400 italic line-clamp-1 mt-1">
                                Catatan: "{req.notes}"
                              </p>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <span className="font-mono font-bold text-slate-900 text-xs">
                            Rp {(Number(req.total_amount) || 0).toLocaleString('id-ID')}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-center">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            req.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            req.status === 'INVOICED' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                            req.status === 'COMPLETED' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                            req.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                            'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {req.status}
                          </span>
                          {req.invoice && (
                            <span className={`block mt-1 font-mono text-[10px] whitespace-nowrap ${liveInvoice ? 'text-slate-500' : 'text-slate-400 line-through'}`} title={liveInvoice ? 'Invoice aktif' : 'Invoice dibatalkan'}>
                              {req.invoice.number}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-52">
                            <button
                              type="button"
                              onClick={() => handleRequestPdf(req)}
                              disabled={Boolean(pdfRequestId)}
                              className="px-2 py-1 bg-white hover:bg-slate-50 text-indigo-700 rounded-lg text-xs font-semibold border border-indigo-200 transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50 disabled:cursor-wait whitespace-nowrap"
                              title="Cetak pengajuan ini sebagai PDF A4, berisi item yang dipesan tenant"
                            >
                              <Printer size={12} />
                              <span>{pdfRequestId === req.id ? 'Membuat…' : 'Cetak PDF'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTenantForModal({
                                  boothCode: req.booth_code,
                                  companyName: req.company_name,
                                  picName: req.pic_name,
                                  phone: req.phone,
                                  email: req.email
                                });
                                setIsGenerateTenantModalOpen(true);
                              }}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-300 transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap"
                              title="Lihat Lembar Formulir A4 & Kirim WA"
                            >
                              <FileText size={12} />
                              <span>Form & WA</span>
                            </button>

                            {liveInvoice && (
                              <button
                                type="button"
                                onClick={() => setCancelInvoiceRequest(req)}
                                className="px-2 py-1 bg-white hover:bg-rose-50 text-rose-700 rounded-lg text-xs font-semibold border border-rose-200 transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap"
                                title={`Batalkan invoice ${liveInvoice.number}`}
                              >
                                <Ban size={12} />
                                <span>Batalkan Invoice</span>
                              </button>
                            )}

                            {isOpen && (
                              <button
                                type="button"
                                onClick={() => setEditRequest(req)}
                                className="px-2 py-1 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold border border-slate-300 transition-colors cursor-pointer flex items-center gap-1"
                                title="Ubah item dan jumlah pengajuan ini"
                              >
                                <Edit2 size={12} />
                                <span>Ubah</span>
                              </button>
                            )}

                            {req.status === 'REJECTED' && !liveInvoice && (
                              <button
                                type="button"
                                onClick={() => handleStatusChange(req.id, 'PENDING')}
                                className="px-2 py-1 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold border border-slate-300 transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap"
                                title="Buka lagi pengajuan yang ditolak"
                              >
                                <RotateCcw size={12} />
                                <span>Buka Lagi</span>
                              </button>
                            )}

                            {isOpen && (
                              <button
                                type="button"
                                onClick={() => handleGenerateInvoice(req.id)}
                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-xs transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                                title="Terbitkan Invoice Resmi A4 untuk Fasilitas Ini"
                              >
                                <FileText size={12} />
                                <span>Buat Invoice</span>
                              </button>
                            )}

                            {isPending && (
                              <button
                                type="button"
                                onClick={() => handleStatusChange(req.id, 'APPROVED')}
                                className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200 transition-colors cursor-pointer"
                                title="Setujui Pengajuan"
                              >
                                <Check size={13} />
                              </button>
                            )}

                            {isOpen && (
                              <button
                                type="button"
                                onClick={() => handleStatusChange(req.id, 'REJECTED')}
                                className="px-2 py-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs transition-colors cursor-pointer"
                                title="Tolak Pengajuan"
                              >
                                <XCircle size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: BUILDER & CATALOG MANAGER */}
      {activeTab === 'builder' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* Left Area: Form Settings & Info (Col span 1) */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              Pengaturan Formulir Fasilitas
            </h2>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Judul Formulir</label>
              <input
                type="text"
                value={builderForm.title}
                onChange={(e) => setBuilderForm({ ...builderForm, title: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Acara / Event</label>
              <input
                type="text"
                value={builderForm.event_title}
                onChange={(e) => setBuilderForm({ ...builderForm, event_title: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Batas Akhir Pengajuan (Deadline)</label>
              <input
                type="date"
                value={builderForm.deadline_date}
                onChange={(e) => setBuilderForm({ ...builderForm, deadline_date: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Deskripsi & Petunjuk</label>
              <textarea
                rows={3}
                value={builderForm.description}
                onChange={(e) => setBuilderForm({ ...builderForm, description: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Syarat & Ketentuan Tambahan</label>
              <textarea
                rows={3}
                value={builderForm.terms_notes}
                onChange={(e) => setBuilderForm({ ...builderForm, terms_notes: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              type="button"
              onClick={handleSaveForm}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              <Save size={15} />
              <span>Simpan & Aktifkan Formulir</span>
            </button>
          </div>

          {/* Right Area: Items Table (Col span 2) */}
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Daftar Item Fasilitas & Harga Satuan</h2>
                <p className="text-xs text-slate-500">Tentukan harga dan kuantitas maksimal yang dapat dipesan tenant.</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryManagerOpen(true)}
                  className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer active:scale-[0.97]"
                >
                  <Tags size={14} />
                  <span>Kelola Kategori</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenItemModal()}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95"
                >
                  <Plus size={14} />
                  <span>Tambah Fasilitas Baru</span>
                </button>
              </div>
            </div>

            {/* Items Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-2.5 px-3">Nama Fasilitas</th>
                    <th className="py-2.5 px-3">Kategori</th>
                    <th className="py-2.5 px-3">Satuan</th>
                    <th className="py-2.5 px-3 text-right">Harga Satuan (Rp)</th>
                    <th className="py-2.5 px-3 text-center">Maks Qty</th>
                    <th className="py-2.5 px-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {builderForm.items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3">
                        <span className="font-bold text-slate-800 block">{item.name}</span>
                        {item.description && (
                          <span className="text-[10px] text-slate-400 block mt-0.5 line-clamp-1">{item.description}</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">
                          {item.category || 'Lainnya'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-600 font-medium">
                        {item.unit || 'Unit'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        Rp {(Number(item.price) || 0).toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-slate-600">
                        {item.max_qty || '-'}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenItemModal(item, idx)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                            title="Edit Item"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteItem(idx)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Hapus Item"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT ITEM */}
      {itemModalOpen && (
        <div className="fixed inset-0 z-[70] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
              {editingItemIdx !== null ? 'Edit Item Fasilitas' : 'Tambah Fasilitas Baru'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Item Fasilitas *</label>
                <input
                  type="text"
                  placeholder="Contoh: Daya Listrik 2A, Meja IBM, dll."
                  value={itemDraft.name}
                  onChange={(e) => setItemDraft({ ...itemDraft, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="facility-item-category" className="block text-xs font-semibold text-slate-700 mb-1">Kategori</label>
                  {newCategoryMode ? (
                    <>
                      <input
                        id="facility-item-category"
                        autoFocus
                        value={itemDraft.category}
                        onChange={(e) => setItemDraft({ ...itemDraft, category: e.target.value })}
                        placeholder="Nama kategori baru"
                        maxLength={60}
                        autoComplete="off"
                        className="w-full bg-white border border-indigo-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      />
                      <button type="button" onClick={() => { setNewCategoryMode(false); setItemDraft({ ...itemDraft, category: categories[0] || '' }); }}
                        className="mt-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer">Pilih dari daftar</button>
                    </>
                  ) : (
                    <select
                      id="facility-item-category"
                      value={itemDraft.category || ''}
                      onChange={(e) => {
                        if (e.target.value === '__new__') { setNewCategoryMode(true); setItemDraft({ ...itemDraft, category: '' }); }
                        else setItemDraft({ ...itemDraft, category: e.target.value });
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                      {itemDraft.category && !categoryOptions.includes(itemDraft.category) && (
                        <option value={itemDraft.category}>{itemDraft.category} (tidak ada di daftar)</option>
                      )}
                      <option value="__new__">+ Buat kategori baru…</option>
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Satuan</label>
                  <input
                    type="text"
                    placeholder="Unit, Titik, Hari, m²"
                    value={itemDraft.unit}
                    onChange={(e) => setItemDraft({ ...itemDraft, unit: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Harga Satuan (Rp) *</label>
                  <input
                    type="number"
                    min="0"
                    step="5000"
                    value={itemDraft.price}
                    onChange={(e) => setItemDraft({ ...itemDraft, price: Number(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Maksimal Jumlah / Booth</label>
                  <input
                    type="number"
                    min="1"
                    value={itemDraft.max_qty}
                    onChange={(e) => setItemDraft({ ...itemDraft, max_qty: Number(e.target.value) || 1 })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Keterangan / Spesifikasi</label>
                <input
                  type="text"
                  placeholder="Keterangan singkat spesifikasi teknis item"
                  value={itemDraft.description}
                  onChange={(e) => setItemDraft({ ...itemDraft, description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setItemModalOpen(false)}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveItem}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
              >
                Simpan Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CHOOSE FROM TEMPLATES */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">Katalog Template Formulir Fasilitas</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsTemplateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                Tutup
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Pilih template bawaan untuk memuat item fasilitas dan tarif standar secara instan ke editor formulir.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
              {templates.map((tpl, i) => (
                <div 
                  key={i} 
                  className="p-4 rounded-xl border border-slate-200 hover:border-indigo-400 hover:shadow-md transition-all flex flex-col justify-between space-y-3 bg-slate-50/50"
                >
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 inline-block">
                      {tpl.template_name || tpl.title}
                    </span>
                    <h4 className="text-xs font-bold text-slate-900">{tpl.title}</h4>
                    <p className="text-[11px] text-slate-500 line-clamp-2">{tpl.description}</p>
                    <span className="text-[10px] text-slate-400 block pt-1">
                      Memuat {(tpl.items || []).length} item fasilitas
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleApplyTemplate(tpl)}
                    className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Terapkan Template Ini</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SAVE AS TEMPLATE */}
      {saveAsTemplateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4 border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
              Simpan sebagai Template Baru
            </h3>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Template</label>
              <input
                type="text"
                placeholder="Contoh: Template Pameran Otomotif 2026"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Seluruh {builderForm.items.length} item fasilitas saat ini akan disimpan sebagai template siap pakai.
              </p>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSaveAsTemplateModalOpen(false)}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveAsTemplate}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-sm cursor-pointer"
              >
                Simpan Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BROADCAST MODAL */}
      <BroadcastTenantModal
        isOpen={isBroadcastModalOpen}
        onClose={() => setIsBroadcastModalOpen(false)}
        activeForm={activeForm}
        showToast={showToast}
        onOpenTenantForm={(tenant) => {
          setSelectedTenantForModal(tenant);
          setIsGenerateTenantModalOpen(true);
        }}
      />

      {/* TENANT FORM GENERATOR (PDF & WA) MODAL */}
      <FacilityCategoryManager
        isOpen={categoryManagerOpen}
        onClose={() => setCategoryManagerOpen(false)}
        categories={categories}
        usage={categoryUsage}
        onChange={handleCategoriesChanged}
        items={builderForm.items}
        formTitle={builderForm.title}
        onAddItem={(category) => handleOpenItemModal(null, null, category)}
        onEditItem={(idx) => handleOpenItemModal(builderForm.items[idx], idx)}
        onDeleteItem={handleDeleteItem}
        itemsDirty={itemsDirty}
        onSaveForm={handleSaveForm}
      />

      <GenerateTenantFacilityModal
        isOpen={isGenerateTenantModalOpen}
        onClose={() => {
          setIsGenerateTenantModalOpen(false);
          setSelectedTenantForModal(null);
        }}
        initialTenant={selectedTenantForModal}
        showToast={showToast}
      />

      <FacilityInvoiceCancelModal
        request={cancelInvoiceRequest}
        onClose={() => setCancelInvoiceRequest(null)}
        onCanceled={(req, outcome) => {
          setCancelInvoiceRequest(null);
          // "Ada perubahan": straight on to the change itself
          if (outcome === 'change') setEditRequest({ ...req, invoice: null, status: 'APPROVED' });
          loadAllData();
        }}
        showToast={showToast}
      />

      <FacilityRequestEditModal
        request={editRequest}
        form={forms.find(f => f.id === editRequest?.form_id) || activeForm}
        onClose={() => setEditRequest(null)}
        onSaved={() => { setEditRequest(null); loadAllData(); }}
        showToast={showToast}
      />

      {printSheet && (
        <div aria-hidden="true" className="fixed left-[-10000px] top-0">
          <FacilityFormA4View
            tenant={printSheet.tenant}
            form={printSheet.form}
            selectedItems={printSheet.items}
            mode={printSheet.mode}
            docNumber={printSheet.docNumber}
          />
        </div>
      )}
    </div>
  );
}
