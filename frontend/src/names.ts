const ADJECTIVES = [
  'Лютий', 'Сонний', 'Голодний', 'Шалений', 'Мудрий', 'Хитрий', 'Дикий', 'Ледачий',
  'Гучний', 'Тихий', 'Смілий', 'Рандомний', 'Космічний', 'Бойовий', 'Пухнастий',
  'Залізний', 'Мокрий', 'Розлючений', 'Веселий', 'Сердитий', 'Загадковий', 'Безстрашний',
];

const NOUNS = [
  'Бобер', 'Гусак', 'Кабан', 'Хом\'як', 'Єнот', 'Тигр', 'Їжак', 'Пінгвін',
  'Дракон', 'Кіт', 'Собака', 'Папуга', 'Краб', 'Жираф', 'Мамонт',
  'Огірок', 'Ведмідь', 'Лось', 'Акула', 'Скунс', 'Лінивець', 'Страус',
];

export function randomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

/**
 * Nobody should have to fill in a form to start a game, so a name is picked on
 * first use and reused for the rest of the tab's session.
 */
export function playerName(): string {
  const saved = sessionStorage.getItem('playerName');
  if (saved) return saved;
  const fresh = randomName();
  sessionStorage.setItem('playerName', fresh);
  return fresh;
}
