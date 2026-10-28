/* Compteurs dérivés des fiches et des dossiers existants. Aucune collection de
   statistiques n'est enregistrée : les identifiants de dossier font foi. */
(function () {
  const list = key => { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
  function collect(extraLinks) {
    const clients = list('hub_clients');
    const portfolio = list('hub_projects');
    const workspaces = list('hub_workspaces');
    const byToken = new Map();
    for (const item of [...workspaces, ...(Array.isArray(extraLinks) ? extraLinks : [])]) {
      if (!item?.token) continue;
      const previous = byToken.get(String(item.token)) || {};
      byToken.set(String(item.token), { ...previous, ...item });
    }
    const professional = [...byToken.values()].filter(w => w.status !== 'trashed');
    return {
      clients: new Set(clients.filter(c => c?.id).map(c => String(c.id))).size,
      professionalProjects: professional.length,
      activeProjects: professional.filter(w => w.stage !== 'done' && w.status !== 'archived').length,
      completedProjects: professional.filter(w => w.stage === 'done').length,
      portfolioProjects: portfolio.length,
      publicProjects: portfolio.filter(p => p && p.hidden !== true && p.visibility?.public !== false).length,
    };
  }
  window.ClientMetrics = { collect };
})();
