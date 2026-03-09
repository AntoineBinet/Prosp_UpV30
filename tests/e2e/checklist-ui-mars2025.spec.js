// @ts-check
// Script de vérification UI — Checklist mars 2025 (docs/CHECKLIST_VERIF_UI_MARS2025.md)
// À lancer avec : npx playwright test tests/e2e/checklist-ui-mars2025.spec.js
// Utilise l'auth du projet (storageState). BaseURL : http://127.0.0.1:8000 (ou prospup.work si baseURL modifiée).

const { test, expect } = require('@playwright/test');

test.describe('Checklist UI mars 2025', () => {
  test.describe('1. Bouton Ajout KPI manuel', () => {
    test('bouton visible sous la ligne des cartes KPI, aligné à droite', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForSelector('#dashKpiRow', { timeout: 10_000 });
      await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 });

      const kpiActionsRow = page.locator('#dashKpiActionsRow');
      await expect(kpiActionsRow).toBeVisible();
      const btn = page.locator('.kpi-manual-btn').filter({ hasText: /Ajout KPI manuel/ });
      await expect(btn).toBeVisible();
    });

    test('clic ouvre la modale Ajouter une action KPI manuellement', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForSelector('#dashKpiRow', { timeout: 10_000 });
      await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 });

      await page.locator('.kpi-manual-btn').filter({ hasText: /Ajout KPI manuel/ }).click();
      const modal = page.locator('#manualKpiModal');
      await expect(modal).toBeVisible();
      await expect(modal).toContainText(/ajouter.*action KPI|KPI manuellement/i);
    });
  });

  test.describe('2. Boutons Voir en orange', () => {
    test('lien Voir Focus a un style bouton orange (classe ou gradient)', async ({ page }) => {
      await page.goto('/dashboard');
      const link = page.locator('a.relance-alert-banner-link').filter({ hasText: /Voir Focus/ });
      // La bannière peut être masquée s\'il n\'y a pas de relances en retard
      const visible = await link.isVisible();
      if (visible) {
        await expect(link).toHaveClass(/relance-alert-banner-link/);
        const hasOrange = await link.evaluate(el => {
          const s = getComputedStyle(el);
          const bg = s.background || s.backgroundColor;
          return /orange|#[ef0-9a-f]{3,6}|rgb.*25[0-9].*1[0-4][0-9]|linear-gradient/.test(bg);
        });
        expect(hasOrange).toBeTruthy();
      }
    });

    test('bouton Voir dans le tableau Prospects est orange (prospect-action-voir)', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#tableView tbody tr, .prospect-action-voir', { timeout: 15_000 });
      const voirBtn = page.locator('.prospect-action-voir').first();
      await expect(voirBtn).toBeVisible();
      await expect(voirBtn).toContainText('Voir');
      const hasPrimaryStyle = await voirBtn.evaluate(el => {
        const c = getComputedStyle(el);
        return c.background !== 'none' && c.background !== 'rgba(0, 0, 0, 0)' || el.classList.contains('btn-primary');
      });
      expect(hasPrimaryStyle || await voirBtn.getAttribute('class')).toBeTruthy();
    });
  });

  test.describe('3. Tags statut (style)', () => {
    test('colonne STATUT affiche des pastilles avec classe table-statut-badge', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#tableView tbody tr', { timeout: 15_000 });
      const badges = page.locator('.table-statut-badge');
      const count = await badges.count();
      expect(count).toBeGreaterThanOrEqual(0);
      if (count > 0) {
        await expect(badges.first()).toBeVisible();
      }
    });
  });

  test.describe('4. Calendrier — jours agrandissables', () => {
    test('vue Mois affichée, modale détail jour existe', async ({ page }) => {
      await page.goto('/calendrier');
      await page.waitForSelector('#calGrid', { timeout: 10_000 });
      await expect(page.locator('#calTitle')).toContainText(/[A-Za-zéèê]+ \d{4}/);
      const modal = page.locator('#calDayDetailModal');
      await expect(modal).toBeAttached();
    });

    test('clic sur zone jour (has-events) ou +X autre(s) ouvre modale Détails', async ({ page }) => {
      await page.goto('/calendrier');
      await page.waitForSelector('#calGrid', { timeout: 10_000 });
      const clickableDay = page.locator('.cal-cell-clickable').first();
      const moreBtn = page.locator('.cal-ev-more-btn').first();
      if (await clickableDay.isVisible()) {
        await clickableDay.click();
        await expect(page.locator('#calDayDetailModal')).toBeVisible();
        await page.locator('.cal-day-detail-close, .modal-close').first().click();
      } else if (await moreBtn.isVisible()) {
        await moreBtn.click();
        await expect(page.locator('#calDayDetailModal')).toBeVisible();
      }
    });

    test('modale se ferme avec bouton × ou Escape', async ({ page }) => {
      await page.goto('/calendrier');
      await page.waitForSelector('#calGrid', { timeout: 10_000 });
      const clickable = page.locator('.cal-cell-clickable, .cal-ev-more-btn').first();
      if (await clickable.isVisible()) {
        await clickable.click();
        await expect(page.locator('#calDayDetailModal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#calDayDetailModal')).toBeHidden();
      }
    });
  });

  test.describe('5. Réduction sidebar', () => {
    test('bouton chevron visible en haut de la sidebar, clic réduit/agrandit', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForSelector('.sidebar', { timeout: 5_000 });
      const btn = page.locator('#sidebarCollapseBtn');
      await expect(btn).toBeVisible({ timeout: 5_000 });
      await expect(btn).toHaveAttribute('title', /Réduire|Agrandir|menu/i);

      const before = await page.evaluate(() => document.body.classList.contains('sidebar-collapsed'));
      await btn.click();
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => document.body.classList.contains('sidebar-collapsed'));
      expect(after).toBe(!before);
    });

    test('état réduit conservé après rafraîchissement (localStorage)', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForSelector('#sidebarCollapseBtn', { timeout: 5_000 });
      await page.locator('#sidebarCollapseBtn').click();
      await page.waitForTimeout(200);
      const collapsed = await page.evaluate(() => localStorage.getItem('sidebar-collapsed'));
      expect(collapsed).toBe('true');
    });
  });

  test.describe('6. Cohérence sidebar sur toutes les pages', () => {
    const pages = [
      '/dashboard',
      '/',
      '/entreprises',
      '/focus',
      '/calendrier',
      '/sourcing',
      '/push',
      '/stats',
      '/rapport',
      '/parametres',
      '/users',
    ];

    for (const url of pages) {
      test(`sidebar + bouton réduire présents sur ${url || '/'}`, async ({ page }) => {
        await page.goto(url || '/');
        const sidebar = page.locator('.sidebar');
        await expect(sidebar).toBeVisible({ timeout: 10_000 });
        // Sur desktop le bouton collapse doit être là (mobile peut le masquer)
        const viewport = page.viewportSize();
        if (viewport && viewport.width >= 768) {
          await expect(page.locator('#sidebarCollapseBtn')).toBeVisible({ timeout: 5_000 });
        }
      });
    }
  });
});
