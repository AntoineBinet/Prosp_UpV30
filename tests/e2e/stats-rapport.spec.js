// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Stats & Rapport', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/stats');
    // Attendre que la page soit chargée
    await page.waitForSelector('.content-header, .stats-tab-btn', { timeout: 10000 });
  });

  test('page Stats affiche les deux onglets', async ({ page }) => {
    // Vérifier que les onglets existent
    const tabStats = page.locator('.stats-tab-btn[data-tab="stats-main"]');
    const tabReport = page.locator('.stats-tab-btn[data-tab="stats-report"]');
    
    await expect(tabStats).toBeVisible();
    await expect(tabReport).toBeVisible();
    
    // Vérifier le texte des onglets
    await expect(tabStats).toContainText('Statistiques');
    await expect(tabReport).toContainText('Rapport');
  });

  test('basculement entre onglets fonctionne', async ({ page }) => {
    const tabStats = page.locator('.stats-tab-btn[data-tab="stats-main"]');
    const tabReport = page.locator('.stats-tab-btn[data-tab="stats-report"]');
    const sectionStats = page.locator('#statsTabMain');
    const sectionReport = page.locator('#statsTabReport');
    
    // Par défaut, onglet Stats actif
    await expect(sectionStats).toBeVisible();
    await expect(sectionReport).not.toBeVisible();
    
    // Cliquer sur onglet Rapport
    await tabReport.click();
    await expect(sectionReport).toBeVisible();
    await expect(sectionStats).not.toBeVisible();
    
    // Cliquer sur onglet Stats
    await tabStats.click();
    await expect(sectionStats).toBeVisible();
    await expect(sectionReport).not.toBeVisible();
  });

  test('onglet Rapport contient les éléments attendus', async ({ page }) => {
    // Aller sur l'onglet Rapport
    await page.locator('.stats-tab-btn[data-tab="stats-report"]').click();
    await page.waitForSelector('#statsTabReport', { state: 'visible' });
    
    // Vérifier le sélecteur de semaine
    const weekInput = page.locator('#reportWeekInput');
    await expect(weekInput).toBeVisible();
    await expect(weekInput).toHaveAttribute('type', 'week');
    
    // Vérifier la checkbox Ollama
    const ollamaCheckbox = page.locator('#reportUseOllama');
    await expect(ollamaCheckbox).toBeVisible();
    
    // Vérifier le bouton génération Excel
    const exportBtn = page.locator('#btnExportWeekly');
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toContainText('Générer');
    
    // Vérifier la checklist KPI
    const kpiChecklist = page.locator('#kpiChecklist');
    await expect(kpiChecklist).toBeVisible();
    
    // Vérifier les boutons KPI
    await expect(page.locator('#btnKpiSelectAll')).toBeVisible();
    await expect(page.locator('#btnKpiSelectNone')).toBeVisible();
    await expect(page.locator('#btnKpiWeek')).toBeVisible();
    await expect(page.locator('#btnKpiExport')).toBeVisible();
  });

  test('checklist KPI fonctionne', async ({ page }) => {
    await page.locator('.stats-tab-btn[data-tab="stats-report"]').click();
    await page.waitForSelector('#kpiChecklist', { state: 'visible' });
    
    // Vérifier que la checklist contient des items
    const checklistItems = page.locator('#kpiChecklist .card');
    const count = await checklistItems.count();
    expect(count).toBeGreaterThan(0);
    
    // Tester "Tout cocher"
    await page.locator('#btnKpiSelectAll').click();
    // Vérifier qu'au moins une checkbox est cochée
    const checkedBoxes = page.locator('#kpiChecklist input[type="checkbox"]:checked');
    const checkedCount = await checkedBoxes.count();
    expect(checkedCount).toBeGreaterThan(0);
    
    // Tester "Tout décocher"
    await page.locator('#btnKpiSelectNone').click();
    const uncheckedBoxes = page.locator('#kpiChecklist input[type="checkbox"]:not(:checked)');
    const uncheckedCount = await uncheckedBoxes.count();
    expect(uncheckedCount).toBeGreaterThan(0);
  });

  test('sélecteur de semaine est initialisé', async ({ page }) => {
    await page.locator('.stats-tab-btn[data-tab="stats-report"]').click();
    await page.waitForSelector('#reportWeekInput', { state: 'visible' });
    
    const weekInput = page.locator('#reportWeekInput');
    const value = await weekInput.inputValue();
    
    // Vérifier que la valeur est au format ISO week (YYYY-WXX)
    expect(value).toMatch(/^\d{4}-W\d{2}$/);
  });
});

test.describe('Calendrier EC1/EC2', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/calendrier');
    await page.waitForSelector('#calGrid', { timeout: 10000 });
  });

  test('calendrier charge les événements', async ({ page }) => {
    // Attendre que le calendrier soit rendu
    await page.waitForTimeout(1000);
    
    // Vérifier que le calendrier existe
    const calGrid = page.locator('#calGrid');
    await expect(calGrid).toBeVisible();
  });

  test('légende calendrier affiche les types', async ({ page }) => {
    const legend = page.locator('.cal-legend');
    await expect(legend).toBeVisible();
    
    // Vérifier que la légende contient les éléments attendus
    await expect(legend).toContainText('RDV');
    await expect(legend).toContainText('Relance');
  });
});
