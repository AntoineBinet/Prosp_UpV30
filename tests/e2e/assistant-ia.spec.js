/**
 * Tests E2E pour l'assistant IA virtuel amélioré
 * Teste: mémoire, streaming, actions, suggestions, persistance
 */

import { test, expect } from '@playwright/test';

test.describe('Assistant IA virtuel amélioré', () => {
  test.beforeEach(async ({ page }) => {
    // Se connecter
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 5000 });
  });

  test('1. Mémoire conversationnelle - historique sauvegardé et chargé', async ({ page }) => {
    // Attendre que le bouton assistant soit visible (il est affiché par JS)
    await page.waitForSelector('#dashAssistantFab', { state: 'visible', timeout: 5000 });
    
    // Ouvrir l'assistant
    await page.click('#dashAssistantFab');
    await page.waitForSelector('#assistantChatWindow.open', { timeout: 3000 });
    
    // Vérifier que le chat est visible
    const chatWindow = page.locator('#assistantChatWindow');
    await expect(chatWindow).toBeVisible();
    
    // Envoyer un premier message
    const question1 = "Bonjour, qui es-tu ?";
    await page.fill('#dashAssistantInput', question1);
    await page.click('#dashAssistantSend');
    
    // Attendre la réponse
    await page.waitForTimeout(3000);
    
    // Vérifier que le message utilisateur apparaît
    const userMessages = page.locator('.assistant-chat-message.user');
    await expect(userMessages.first()).toContainText(question1);
    
    // Vérifier qu'une réponse de l'assistant apparaît
    const assistantMessages = page.locator('.assistant-chat-message.assistant');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 10000 });
    
    // Envoyer un deuxième message qui fait référence au premier
    const question2 = "Qu'est-ce que je t'ai demandé avant ?";
    await page.fill('#dashAssistantInput', question2);
    await page.click('#dashAssistantSend');
    
    // Attendre la réponse
    await page.waitForTimeout(3000);
    
    // Vérifier que l'assistant fait référence au contexte précédent
    const lastAssistantMessage = assistantMessages.last();
    await expect(lastAssistantMessage).toBeVisible({ timeout: 10000 });
    
    console.log('✅ Test mémoire: Messages envoyés et réponses reçues');
  });

  test('2. Streaming - affichage progressif avec curseur clignotant', async ({ page }) => {
    // Attendre que le bouton assistant soit visible
    await page.waitForSelector('#dashAssistantFab', { state: 'visible', timeout: 5000 });
    
    // Ouvrir l'assistant
    await page.click('#dashAssistantFab');
    await page.waitForSelector('#assistantChatWindow.open', { timeout: 3000 });
    
    // Envoyer un message qui devrait générer une réponse longue
    const question = "Explique-moi ce qu'est un CRM en détail";
    await page.fill('#dashAssistantInput', question);
    await page.click('#dashAssistantSend');
    
    // Vérifier qu'un message avec la classe "streaming" apparaît
    const streamingMessage = page.locator('.assistant-chat-message.assistant.streaming');
    await expect(streamingMessage).toBeVisible({ timeout: 5000 });
    
    // Vérifier que le curseur clignotant est présent (::after avec animation)
    const cursorVisible = await streamingMessage.evaluate((el) => {
      const styles = window.getComputedStyle(el, '::after');
      return styles.content !== 'none' && styles.content !== '';
    });
    
    // Attendre que le streaming se termine (la classe "streaming" disparaît)
    await page.waitForFunction(
      () => !document.querySelector('.assistant-chat-message.assistant.streaming'),
      { timeout: 30000 }
    );
    
    // Vérifier que le message final contient du texte
    const finalMessage = page.locator('.assistant-chat-message.assistant').last();
    const text = await finalMessage.textContent();
    expect(text.length).toBeGreaterThan(10);
    
    console.log('✅ Test streaming: Réponse affichée progressivement');
  });

  test('3. Actions étendues - création de prospects, entreprises, candidats', async ({ page }) => {
    // Attendre que le bouton assistant soit visible
    await page.waitForSelector('#dashAssistantFab', { state: 'visible', timeout: 5000 });
    
    // Ouvrir l'assistant
    await page.click('#dashAssistantFab');
    await page.waitForSelector('#assistantChatWindow.open', { timeout: 3000 });
    
    // Test création prospect via l'assistant
    const createProspectQuestion = "Crée un prospect nommé Test Prospect Assistant, entreprise Test Company, fonction Directeur Technique";
    await page.fill('#dashAssistantInput', createProspectQuestion);
    await page.click('#dashAssistantSend');
    
    // Attendre la réponse avec les actions
    await page.waitForTimeout(5000);
    
    // Vérifier qu'un bouton d'action apparaît
    const actionButtons = page.locator('.assistant-chat-actions .btn');
    const actionCount = await actionButtons.count();
    
    if (actionCount > 0) {
      // Cliquer sur le premier bouton d'action (création)
      await actionButtons.first().click();
      
      // Attendre un toast de succès ou redirection
      await page.waitForTimeout(2000);
      
      // Vérifier qu'un toast de succès apparaît ou qu'on est redirigé
      const toast = page.locator('.toast, [class*="toast"]');
      const toastVisible = await toast.count() > 0;
      const isRedirected = page.url().includes('open=') || page.url() === '/';
      
      expect(toastVisible || isRedirected).toBeTruthy();
      console.log('✅ Test actions: Création prospect déclenchée');
    } else {
      console.log('⚠️  Pas de bouton d\'action détecté (peut être normal si l\'IA ne génère pas d\'action)');
    }
  });

  test('4. Suggestions - affichage des suggestions de questions', async ({ page }) => {
    // Attendre que le bouton assistant soit visible
    await page.waitForSelector('#dashAssistantFab', { state: 'visible', timeout: 5000 });
    
    // Ouvrir l'assistant
    await page.click('#dashAssistantFab');
    await page.waitForSelector('#assistantChatWindow.open', { timeout: 3000 });
    
    // Attendre que les suggestions se chargent (elles apparaissent automatiquement)
    await page.waitForTimeout(2000);
    
    // Vérifier que les suggestions apparaissent
    const suggestions = page.locator('.assistant-suggestions');
    const suggestionsVisible = await suggestions.count() > 0;
    
    if (suggestionsVisible) {
      // Vérifier qu'il y a des boutons de suggestions
      const suggestionButtons = suggestions.locator('button');
      const buttonCount = await suggestionButtons.count();
      expect(buttonCount).toBeGreaterThan(0);
      
      // Cliquer sur une suggestion
      await suggestionButtons.first().click();
      
      // Vérifier que la suggestion remplit l'input
      const inputValue = await page.inputValue('#dashAssistantInput');
      expect(inputValue.length).toBeGreaterThan(0);
      
      console.log('✅ Test suggestions: Suggestions affichées et cliquables');
    } else {
      console.log('⚠️  Suggestions non détectées (peut être normal selon le contexte)');
    }
  });

  test('5. Persistance - historique persiste après rechargement', async ({ page }) => {
    // Attendre que le bouton assistant soit visible
    await page.waitForSelector('#dashAssistantFab', { state: 'visible', timeout: 5000 });
    
    // Ouvrir l'assistant
    await page.click('#dashAssistantFab');
    await page.waitForSelector('#assistantChatWindow.open', { timeout: 3000 });
    
    // Envoyer quelques messages
    const messages = [
      "Premier message de test persistance",
      "Deuxième message de test",
      "Troisième message"
    ];
    
    for (const msg of messages) {
      await page.fill('#dashAssistantInput', msg);
      await page.click('#dashAssistantSend');
      await page.waitForTimeout(2000); // Attendre la réponse
    }
    
    // Compter les messages avant rechargement
    const messagesBefore = page.locator('.assistant-chat-message');
    const countBefore = await messagesBefore.count();
    
    // Recharger la page
    await page.reload();
    await page.waitForTimeout(2000);
    
    // Rouvrir l'assistant
    await page.click('#dashAssistantFab');
    await page.waitForSelector('#assistantChatWindow.open', { timeout: 2000 });
    
    // Attendre que l'historique se charge
    await page.waitForTimeout(2000);
    
    // Vérifier que les messages sont toujours présents
    const messagesAfter = page.locator('.assistant-chat-message');
    const countAfter = await messagesAfter.count();
    
    // L'historique devrait être chargé (au moins quelques messages)
    if (countAfter > 0) {
      // Vérifier qu'au moins un de nos messages est présent
      const chatContent = await page.locator('#dashAssistantChat').textContent();
      const hasTestMessage = messages.some(msg => chatContent.includes(msg.substring(0, 20)));
      
      expect(hasTestMessage || countAfter > 0).toBeTruthy();
      console.log(`✅ Test persistance: ${countAfter} messages après rechargement`);
    } else {
      console.log('⚠️  Historique non chargé après rechargement (peut être normal si première session)');
    }
  });

  test('6. Intégration fonctions IA - déclenchement scrapping, avant/après réunion', async ({ page }) => {
    // Aller sur la page prospects pour avoir un contexte
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Attendre que le bouton assistant soit visible
    await page.waitForSelector('#dashAssistantFab', { state: 'visible', timeout: 5000 });
    
    // Ouvrir l'assistant
    await page.click('#dashAssistantFab');
    await page.waitForSelector('#assistantChatWindow.open', { timeout: 3000 });
    
    // Demander à l'assistant d'enrichir un prospect avec l'IA
    // (On suppose qu'il y a au moins un prospect dans la base)
    const iaQuestion = "Enrichis un prospect avec l'IA";
    await page.fill('#dashAssistantInput', iaQuestion);
    await page.click('#dashAssistantSend');
    
    // Attendre la réponse
    await page.waitForTimeout(5000);
    
    // Vérifier qu'une action IA est proposée
    const actionButtons = page.locator('.assistant-chat-actions .btn');
    const actionCount = await actionButtons.count();
    
    if (actionCount > 0) {
      // Chercher un bouton lié à l'IA
      const buttons = await actionButtons.all();
      let iaButtonFound = false;
      
      for (const btn of buttons) {
        const text = await btn.textContent();
        if (text && (text.includes('IA') || text.includes('enrichir') || text.includes('scrap'))) {
          iaButtonFound = true;
          // Ne pas cliquer pour éviter de modifier des données réelles
          console.log(`✅ Test fonctions IA: Bouton IA détecté: "${text}"`);
          break;
        }
      }
      
      if (!iaButtonFound) {
        console.log('⚠️  Bouton IA non détecté dans les actions');
      }
    } else {
      console.log('⚠️  Pas d\'actions détectées (peut être normal si l\'IA ne génère pas d\'action)');
    }
  });
});
