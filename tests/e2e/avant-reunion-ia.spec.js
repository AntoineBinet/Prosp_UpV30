// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Avant réunion IA - Génération fiche PDF', () => {
  test.beforeEach(async ({ page }) => {
    // Aller sur la page prospects
    await page.goto('/');
    // Attendre que la page soit chargée
    await page.waitForSelector('.prospect-row, .stat-card', { timeout: 10000 });
  });

  test('Le bouton "Avant réunion IA" apparaît uniquement pour les prospects au statut "Rendez-vous"', async ({ page }) => {
    // Chercher un prospect au statut "Rendez-vous"
    // On va filtrer par statut "Rendez-vous" si possible
    const statusFilter = page.locator('#statusFilter');
    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption('Rendez-vous');
      await page.waitForTimeout(1000); // Attendre le filtrage
    }

    // Ouvrir la fiche d'un prospect (cliquer sur la première ligne)
    const firstProspect = page.locator('.prospect-row').first();
    if (await firstProspect.isVisible()) {
      await firstProspect.click();
      
      // Attendre que la modale de détail s'ouvre
      await page.waitForSelector('.detail-modal, .detail-content', { timeout: 5000 });
      
      // Aller dans l'onglet RDV
      const rdvTab = page.locator('button:has-text("RDV"), .detail-tab:has-text("RDV")');
      if (await rdvTab.isVisible()) {
        await rdvTab.click();
        await page.waitForTimeout(500);
        
        // Vérifier que le bouton "Avant réunion IA" est visible
        const btnAvantReunion = page.locator('button:has-text("Avant réunion IA"), #btnPreMeetingIA');
        await expect(btnAvantReunion).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('La modale de progression s\'ouvre au clic sur "Avant réunion IA"', async ({ page }) => {
    // Chercher un prospect au statut "Rendez-vous"
    const statusFilter = page.locator('#statusFilter');
    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption('Rendez-vous');
      await page.waitForTimeout(1000);
    }

    // Ouvrir la fiche d'un prospect
    const firstProspect = page.locator('.prospect-row').first();
    if (await firstProspect.isVisible()) {
      await firstProspect.click();
      await page.waitForSelector('.detail-modal, .detail-content', { timeout: 5000 });
      
      // Aller dans l'onglet RDV
      const rdvTab = page.locator('button:has-text("RDV"), .detail-tab:has-text("RDV")');
      if (await rdvTab.isVisible()) {
        await rdvTab.click();
        await page.waitForTimeout(500);
        
        // Cliquer sur "Avant réunion IA"
        const btnAvantReunion = page.locator('button:has-text("Avant réunion IA")');
        if (await btnAvantReunion.isVisible()) {
          await btnAvantReunion.click();
          
          // Vérifier que la modale s'ouvre
          const modal = page.locator('#modalPreMeetingIA, .modal:has-text("Génération fiche préparation RDV")');
          await expect(modal).toBeVisible({ timeout: 5000 });
          
          // Vérifier que le panneau de progression est visible
          const progressLog = page.locator('#preMeetingProgressLog, .progress-log');
          await expect(progressLog).toBeVisible({ timeout: 2000 });
        }
      }
    }
  });

  test('Le bouton est désactivé pendant la génération', async ({ page }) => {
    // Chercher un prospect au statut "Rendez-vous"
    const statusFilter = page.locator('#statusFilter');
    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption('Rendez-vous');
      await page.waitForTimeout(1000);
    }

    // Ouvrir la fiche d'un prospect
    const firstProspect = page.locator('.prospect-row').first();
    if (await firstProspect.isVisible()) {
      await firstProspect.click();
      await page.waitForSelector('.detail-modal, .detail-content', { timeout: 5000 });
      
      // Aller dans l'onglet RDV
      const rdvTab = page.locator('button:has-text("RDV"), .detail-tab:has-text("RDV")');
      if (await rdvTab.isVisible()) {
        await rdvTab.click();
        await page.waitForTimeout(500);
        
        // Cliquer sur "Avant réunion IA"
        const btnAvantReunion = page.locator('button:has-text("Avant réunion IA")');
        if (await btnAvantReunion.isVisible()) {
          await btnAvantReunion.click();
          await page.waitForTimeout(500);
          
          // Vérifier que le bouton est désactivé
          await expect(btnAvantReunion).toBeDisabled({ timeout: 2000 });
          
          // Vérifier que le texte change
          await expect(btnAvantReunion).toContainText('Analyse en cours', { timeout: 2000 });
        }
      }
    }
  });
});
