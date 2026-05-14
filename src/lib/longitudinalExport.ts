import type { LongitudinalSubmission } from '@/types/longitudinal';
import type { FormDef } from '@/lib/store';

export function exportLongitudinalCSV(submissions: LongitudinalSubmission[], form: FormDef): void {
  if (submissions.length === 0) return;
  const fixedFields = form.fields.filter(f => f.longitudinalRole === 'fixed' && f.type !== 'section_header' && f.type !== 'page_break');
  const trackedFields = form.fields.filter(f => f.longitudinalRole !== 'fixed' && f.type !== 'section_header' && f.type !== 'page_break');
  const maxVisits = Math.max(...submissions.map(s => s.visits.length), 0);

  const headers = [
    ...fixedFields.map(f => f.label),
    ...Array.from({ length: maxVisits }, (_, i) =>
      trackedFields.map(f => `${f.label}_v${i + 1}`)
    ).flat(),
  ];

  const rows = submissions.map(sub => [
    ...fixedFields.map(f => String(sub.fixedData[f.id] ?? '')),
    ...Array.from({ length: maxVisits }, (_, i) =>
      trackedFields.map(f => String(sub.visits[i]?.data[f.id] ?? ''))
    ).flat(),
  ]);

  const csv = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${form.name.replace(/[^a-z0-9]/gi, '_')}_longitudinal_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
