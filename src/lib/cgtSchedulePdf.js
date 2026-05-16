/**
 * CGT schedule PDF (jsPDF + jspdf-autotable, A4).
 */

import autoTable from 'jspdf-autotable'
import { jsPDF } from 'jspdf'

const qtyFmt = new Intl.NumberFormat('en-AU', {
  maximumFractionDigits: 8,
})

/** DD MMM YYYY — ASCII-safe for Helvetica in jsPDF */
function formatPdfDate(d) {
  const x = d instanceof Date ? d : new Date(d)
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const day = String(x.getDate()).padStart(2, '0')
  const mon = months[x.getMonth()]
  const yr = x.getFullYear()
  return `${day} ${mon} ${yr}`
}

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return n < 0 ? `-$${abs}` : `$${abs}`
}

/** Sub-row parcel lines: 8pt italic grey */
const SUB_ROW_STYLE = {
  fontSize: 8,
  fontStyle: 'italic',
  textColor: 120,
}

function formatQty(n) {
  return qtyFmt.format(Number(n) || 0)
}

function formatMarket(market, assetClass) {
  const m = String(market || '').trim().toUpperCase()
  if (
    m === 'NASDAQ' ||
    m === 'NYSE' ||
    m === 'ASX' ||
    m === 'NYSE ARCA' ||
    m === 'ARCA' ||
    m === 'CXA' ||
    m === 'OPT'
  ) {
    return m === 'ARCA' ? 'NYSE ARCA' : m
  }
  if (m === 'BIT' || m === 'CRYPTO') return 'CRYPTO'
  const ac = String(assetClass || 'OTHER').toUpperCase()
  if (ac === 'NASDAQ' || ac === 'NYSE') return ac
  if (ac === 'ASX') return 'ASX'
  if (ac === 'US') return 'US'
  if (ac === 'CRYPTO') return 'CRYPTO'
  if (ac === 'ETF') return 'ETF'
  return ac === 'OTHER' ? '—' : ac
}

function saleMatchTotals(sale) {
  let cost = 0
  let gross = 0
  let taxable = 0
  for (const m of sale.matches) {
    cost += m.costBaseProRata
    gross += m.gain
    taxable += m.prePoolTaxableWeight
  }
  return { cost, gross, taxable }
}

function padYmd(d) {
  const x = d instanceof Date ? d : new Date(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * Build the payload for {@link exportCgtPdf} from FY engine output.
 */
export function buildCgtPdfReportData({
  fy,
  methodCode,
  generatedAt,
  result,
  comparison,
}) {
  return {
    fy,
    method: methodSubtitle(methodCode),
    methodFileSlug: methodFilenameSlug(methodCode),
    generatedAt,
    taxableCapitalGain: result.taxableCapitalGain,
    grossGains: result.grossGains,
    grossLosses: result.grossLosses,
    discountApplied: result.discountSaved,
    priorYearLossesApplied: result.priorYearLossesApplied ?? 0,
    lossCarryForward: result.lossCarryForward,
    methodComparison: {
      FIFO: comparison.FIFO.taxableCapitalGain,
      LIFO: comparison.LIFO.taxableCapitalGain,
      minGain: comparison.minGain.taxableCapitalGain,
    },
    bestMethod: bestMethodLabel(pickBestMethodKey(comparison)),
    sales: result.sales,
  }
}

/**
 * @param {ReturnType<typeof buildCgtPdfReportData>} reportData
 */
export function exportCgtPdf(reportData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 40
  const innerW = pageWidth - margin * 2

  const genStr = formatPdfDate(reportData.generatedAt)

  // Header
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Capital Gains Tax Schedule', margin, 50)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100)
  doc.text(
    `Financial Year ${reportData.fy} · Method: ${reportData.method} · Generated ${genStr}`,
    margin,
    68,
  )
  doc.setDrawColor(200)
  doc.line(margin, 80, pageWidth - margin, 80)
  doc.setTextColor(0)

  // Summary
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Summary', margin, 105)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')

  const summary = [
    ['Net Taxable Capital Gain', fmt(reportData.taxableCapitalGain)],
    ['Gross Gains', fmt(reportData.grossGains)],
    ['Gross Losses', fmt(reportData.grossLosses)],
    ['Discount Applied (50%)', fmt(reportData.discountApplied)],
    ['Prior-Year Losses Applied', fmt(reportData.priorYearLossesApplied)],
    ['Loss Carry-Forward', fmt(reportData.lossCarryForward)],
  ]

  autoTable(doc, {
    startY: 115,
    head: [],
    body: summary,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3, font: 'helvetica' },
    columnStyles: {
      0: { cellWidth: 250, fontStyle: 'normal' },
      1: { cellWidth: 120, halign: 'right', fontStyle: 'bold' },
    },
  })

  // Method comparison
  let y = doc.lastAutoTable.finalY + 15
  doc.setFontSize(9)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(80)
  const comparisonLine = `FIFO ${fmt(reportData.methodComparison.FIFO)} · LIFO ${fmt(reportData.methodComparison.LIFO)} · Min-Gain ${fmt(reportData.methodComparison.minGain)}. Best method: ${reportData.bestMethod}.`
  const comparisonLines = doc.splitTextToSize(comparisonLine, innerW)
  doc.text(comparisonLines, margin, y)
  y += comparisonLines.length * 11 + 20
  doc.setTextColor(0)

  // Realised disposals
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Realised Disposals', margin, y)
  y += 12

  const tableHead = [
    [
      'Date',
      'Ticker',
      'Market',
      'Qty',
      'Proceeds',
      'Cost Base',
      'Days',
      'Disc?',
      'Gross G/L',
      'Taxable Gain',
    ],
  ]

  /** @type {unknown[][]} */
  const tableBody = []

  if (reportData.sales.length === 0) {
    tableBody.push([
      {
        content: 'No realised disposals in this financial year.',
        colSpan: 10,
        styles: { fontStyle: 'italic', textColor: 120 },
      },
    ])
  }

  for (const sale of reportData.sales) {
    const totals = saleMatchTotals(sale)
    const ac = sale.assetClass ?? 'OTHER'
    const mkt = formatMarket(sale.market, ac)
    const saleDate =
      sale.date instanceof Date ? sale.date : new Date(sale.date)

    const totalGain = totals.gross
    const totalTaxable = totals.taxable

    tableBody.push([
      formatPdfDate(saleDate),
      { content: String(sale.ticker || ''), styles: { fontStyle: 'bold' } },
      mkt,
      { content: formatQty(sale.quantitySold), styles: { halign: 'right' } },
      { content: fmt(sale.netProceedsAud), styles: { halign: 'right' } },
      { content: fmt(totals.cost), styles: { halign: 'right' } },
      '',
      '',
      {
        content: fmt(totalGain),
        styles: {
          halign: 'right',
          textColor: totalGain >= 0 ? [22, 163, 74] : [220, 38, 38],
        },
      },
      {
        content: fmt(totalTaxable),
        styles: { halign: 'right', fontStyle: 'bold', fontSize: 10 },
      },
    ])

    for (const m of sale.matches) {
      const acquired =
        m.acquiredDate instanceof Date
          ? m.acquiredDate
          : new Date(m.acquiredDate)
      const g = Number(m.gain) || 0
      const subTax = m.prePoolTaxableWeight
      tableBody.push([
        {
          content: `Parcel acquired ${formatPdfDate(acquired)}`,
          colSpan: 2,
          styles: { ...SUB_ROW_STYLE },
        },
        '',
        {
          content: formatQty(m.quantity),
          styles: { ...SUB_ROW_STYLE, halign: 'right' },
        },
        {
          content: fmt(m.proceedsProRata),
          styles: { ...SUB_ROW_STYLE, halign: 'right' },
        },
        {
          content: fmt(m.costBaseProRata),
          styles: { ...SUB_ROW_STYLE, halign: 'right' },
        },
        {
          content: String(m.daysHeld ?? ''),
          styles: { ...SUB_ROW_STYLE, halign: 'right' },
        },
        {
          content: m.discountEligible ? 'Yes' : '—',
          styles: { ...SUB_ROW_STYLE, halign: 'center' },
        },
        {
          content: fmt(g),
          styles: {
            ...SUB_ROW_STYLE,
            halign: 'right',
            textColor: g >= 0 ? [22, 163, 74] : [220, 38, 38],
          },
        },
        {
          content: fmt(subTax),
          styles: { ...SUB_ROW_STYLE, halign: 'right' },
        },
      ])
    }

    if (sale.shortfall > 0) {
      tableBody.push([
        {
          content: `Warning: insufficient parcels — short by ${sale.shortfall} units.`,
          colSpan: 10,
          styles: { textColor: [230, 81, 0], fontSize: 8 },
        },
      ])
    }
  }

  autoTable(doc, {
    startY: y + 5,
    head: tableHead,
    body: tableBody,
    theme: 'striped',
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: 30,
      fontSize: 9,
      fontStyle: 'bold',
      font: 'helvetica',
    },
    styles: { fontSize: 9, cellPadding: 4, font: 'helvetica', valign: 'middle' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'center' },
      8: { halign: 'right' },
      9: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  })

  // Notes — need ≥100pt below table (+ room above footer); 20pt gap after table content
  const tableEndY = doc.lastAutoTable.finalY
  const footerReserve = 36
  const notesMinGapBelowTable = 100
  const notesTopPad = 20
  const usableBottom = pageHeight - footerReserve
  const remainingBelowTable = usableBottom - tableEndY

  let notesY
  if (remainingBelowTable < notesMinGapBelowTable) {
    doc.addPage()
    notesY = margin + notesTopPad
  } else {
    notesY = tableEndY + notesTopPad
  }

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30)
  doc.text('Notes', margin, notesY)
  notesY += 14

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  const notes = [
    'Calculation basis: ATO rules for individual taxpayer at marginal rate.',
    '50% CGT discount applied to gains on parcels held more than 12 months.',
    'Capital losses applied against non-discount-eligible gains first, then against discount-eligible gains before discount is applied.',
    `Parcel allocation method: ${reportData.method}.`,
    'This schedule is prepared for tax planning purposes. Verify all figures with your tax advisor before lodging.',
  ]

  const notesBottomSafe = pageHeight - footerReserve - 10

  notes.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, innerW)
    doc.text(wrapped, margin, notesY)
    notesY += wrapped.length * 11 + 4
    if (notesY > notesBottomSafe) {
      doc.addPage()
      notesY = margin + notesTopPad
    }
  })

  // Footer every page
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120)
    doc.text(
      `PortfolioPilot CGT Schedule — FY${reportData.fy}`,
      margin,
      pageHeight - 22,
    )
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth - margin,
      pageHeight - 22,
      { align: 'right' },
    )
  }

  doc.setPage(pageCount)

  const fname = `CGT_Schedule_FY${reportData.fy}_${reportData.methodFileSlug}_${padYmd(reportData.generatedAt)}.pdf`
  doc.save(fname)
}

function methodSubtitle(code) {
  if (code === 'LIFO') return 'LIFO'
  if (code === 'MIN_GAIN') return 'Min-Gain'
  return 'FIFO'
}

function methodFilenameSlug(code) {
  if (code === 'MIN_GAIN') return 'MinGain'
  if (code === 'LIFO') return 'LIFO'
  return 'FIFO'
}

function bestMethodLabel(key) {
  if (key === 'MIN_GAIN') return 'Min-Gain'
  return key
}

function pickBestMethodKey(comparison) {
  const rows = [
    ['FIFO', comparison.FIFO.taxableCapitalGain],
    ['LIFO', comparison.LIFO.taxableCapitalGain],
    ['MIN_GAIN', comparison.minGain.taxableCapitalGain],
  ]
  rows.sort((a, b) => a[1] - b[1])
  return rows[0][0]
}
