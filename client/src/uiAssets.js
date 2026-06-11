const modules = import.meta.glob('./assets/ui/*.{png,jpg,jpeg,svg,webp}', { eager: true, import: 'default' });

function find(name) {
  const entry = Object.entries(modules).find(([path]) => path.includes(`/${name}.`));
  return entry?.[1];
}

export const COIN_ICONS = { heads: find('coin-heads'), tails: find('coin-tails') };
export const ROLE_ICONS = { landlord: find('icon-landlord'), farmer: find('icon-farmer'), bank: find('icon-bank') };
export const TABLE_BG = find('table-bg');
export const CONFIRM_BUTTON = { normal: find('confirm_button_normal'), pressed: find('confirm_button_pressed') };
export const CARD_FACES = {
  1: find('money_card_1'),
  2: find('money_card_2'),
  5: find('money_card_5'),
  10: find('money_card_10'),
};
