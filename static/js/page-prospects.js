(function(){
  function run(){
    const fn = window.bootstrap || window.appBootstrap;
    if (typeof fn !== 'function') {
      console.error('[ProspectionApp] bootstrap() introuvable. Vérifiez que /static/js/app.js est bien chargé (Ctrl+F5).');
      return;
    }
    fn('prospects');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
