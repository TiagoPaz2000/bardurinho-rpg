import { catalog, validateCatalog } from '@bardurinho/content';

const issues = validateCatalog(catalog);
const counts = {
  classes: Object.keys(catalog.classes).length,
  abilities: Object.keys(catalog.abilities).length,
  items: Object.keys(catalog.items).length,
  statuses: Object.keys(catalog.statuses).length,
  objects: Object.keys(catalog.objects).length,
};
console.log(`Conteúdo ${catalog.contentVersion}:`, counts);
if (issues.length) {
  for (const i of issues) console.error(`  ✗ ${i.definitionId}: ${i.message}`);
  process.exit(1);
}
console.log('  ✓ catálogo válido');
