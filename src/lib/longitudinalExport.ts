import type { LongitudinalSubmission } from '@/types/longitudinal';
import type { FormDef, FormField } from '@/lib/store';

type BPVal = { systolic: number | string; diastolic: number | string };

function isBP(val: unknown): val is BPVal {
  return typeof val === 'object' && val !== null && 'systolic' in val;
}

function isBPField(f: FormField): boolean {
  return f.type === 'measurement' && (f as { measurementType?: string }).measurementType === 'BP';
}

// Returns the column header(s) for a field: BP fields get two columns, all others one
function fieldHeaders(f: FormField, visitIndex: number): string[] {
  const suffix = `_v${visitIndex + 1}`;
  if (isBPField(f)) return [`${f.variableName ?? f.label}_SBP${suffix}`, `${f.variableName ?? f.label}_DBP${suffix}`];
  return [`${f.variableName ?? f.label}${suffix}`];
}

// Returns the cell value(s) for a field value: BP fields get two cells, all others one
function fieldValues(f: FormField, val: unknown): string[] {
  if (isBPField(f)) {
    if (isBP(val)) return [String(val.systolic ?? ''), String(val.diastolic ?? '')];
    return ['', ''];
  }
  if (val === undefined || val === null || val === '') return [''];
  if (typeof val === 'boolean') return [val ? 'Yes' : 'No'];
  if (Array.isArray(val)) return [val.join(' | ')];
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    if ('systolic' in o) return [`${o.systolic}/${o.diastolic}`];
    return [JSON.stringify(val)];
  }
  return [String(val)];
}

export function exportLongitudinalCSV(submissions: LongitudinalSubmission[], form: FormDef): void {
  if (submissions.length === 0) return;
  const fixedFields = form.fields.filter(f => f.longitudinalRole === 'fixed' && f.type !== 'section_header' && f.type !== 'page_break');
  const trackedFields = form.fields.filter(f => f.longitudinalRole !== 'fixed' && f.type !== 'section_header' && f.type !== 'page_break');
  const maxVisits = Math.max(...submissions.map(s => s.visits.length), 0);

  const headers = [
    ...fixedFields.flatMap(f => {
      if (isBPField(f)) return [`${f.variableName ?? f.label}_SBP`, `${f.variableName ?? f.label}_DBP`];
      return [f.variableName ?? f.label];
    }),
    'Visits',
    ...Array.from({ length: maxVisits }, (_, i) =>
      trackedFields.flatMap(f => fieldHeaders(f, i))
    ).flat(),
  ];

  const rows = submissions.map(sub => [
    ...fixedFields.flatMap(f => fieldValues(f, sub.fixedData[f.id])),
    String(sub.visits.length),
    ...Array.from({ length: maxVisits }, (_, i) =>
      trackedFields.flatMap(f => fieldValues(f, sub.visits[i]?.data[f.id]))
    ).flat(),
  ]);

  const BOM = '﻿';
  const csv = BOM + [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${form.name.replace(/[^a-z0-9]/gi, '_')}_longitudinal_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
