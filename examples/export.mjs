// Teaching fixture, not production software or historical benchmark evidence.
export function exportRows(rows, selectedRegion) {
  const columns = ['name', 'region', 'note'];
  const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return [columns.join(','), ...rows.map(row => columns.map(key => quote(row[key])).join(','))].join('\r\n');
}
