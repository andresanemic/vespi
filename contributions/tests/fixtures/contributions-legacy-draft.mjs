export async function seedLegacyDraft(page, network = 'testnet') {
  await page.evaluate(network => {
    const identity = JSON.parse(localStorage.getItem('vespi-contributions:identity:v1') || 'null');
    localStorage.setItem('vespi-contributions:draft:' + (identity?.account ?? 'guest') + ':' + network + ':encounter',
      JSON.stringify({ expires: Date.now() + 86_400_000, value: {
        id: 'legacy-draft', type: 'reunion', title: '', date: new Date().toISOString().slice(0, 10), where: '',
        summary: '', a: identity?.displayName ?? '', b: '', contributions: [{ id: 'first', from: 'a', text: '', url: '' }],
        confirmations: { a: false, b: false }, status: 'draft', revision: 1, created: Date.now(), step: 1,
      } }));
  }, network);
}
