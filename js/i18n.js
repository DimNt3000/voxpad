/**
 * Two language interface, English and Greek.
 *
 * Static markup is translated through data attributes so the HTML stays the
 * single source of truth for structure. Anything built at runtime goes through
 * t(), where a value can be a plain string or a function of its arguments.
 */

const SCRIPTS = {
  en: { Greek: 'Greek', Cyrillic: 'Cyrillic', Arabic: 'Arabic', Hebrew: 'Hebrew' },
  el: { Greek: 'Ελληνικά', Cyrillic: 'Κυριλλικά', Arabic: 'Αραβικά', Hebrew: 'Εβραϊκά' },
};

const STRINGS = {
  en: {
    'tagline': 'Text to speech that runs on your device.',

    'ui.language': 'Interface language',
    'ui.theme': 'Theme',
    'ui.themeToDark': 'Switch to dark theme',
    'ui.themeToLight': 'Switch to light theme',
    'ui.close': 'Close',

    'doc.heading': 'Your text',
    'doc.tabs': 'Text view',
    'doc.label': 'Text to read aloud',
    'doc.placeholder': 'Paste your text here, or drop a .txt file anywhere on the page.',

    'tab.edit': 'Edit',
    'tab.read': 'Read',

    'tool.import': 'Import file',
    'tool.sample': 'Sample',
    'tool.clear': 'Clear',
    'tool.clearConfirm': 'Confirm clear',

    'reader.label': 'Text being read',
    'reader.empty': 'Nothing to read yet. Add some text in the Edit tab.',
    'reader.hint': 'Click any sentence to start reading from there.',

    'voice.heading': 'Voice',
    'voice.language': 'Language',
    'voice.allLanguages': 'All languages',
    'voice.voice': 'Voice',
    'voice.useMatch': 'Use it',
    'voice.none': 'No voices are installed in this browser.',
    'voice.local': 'Runs on this device, no connection needed.',
    'voice.network': 'Rendered by the browser vendor over the network.',
    'voice.hint': ({ script }) => `This text is in ${script}. Use a matching voice?`,
    'voice.count': ({ n }) => `${n} ${n === 1 ? 'voice' : 'voices'} available.`,

    'delivery.heading': 'Delivery',
    'delivery.rate': 'Speed',
    'delivery.pitch': 'Pitch',
    'delivery.volume': 'Volume',
    'delivery.reset': 'Reset all',

    'preset.group': 'Speed presets',
    'preset.slow': 'Slow',
    'preset.normal': 'Normal',
    'preset.brisk': 'Brisk',

    'transport.prev': 'Previous sentence',
    'transport.play': 'Play',
    'transport.pause': 'Pause',
    'transport.resume': 'Resume',
    'transport.stop': 'Stop',
    'transport.next': 'Next sentence',
    'transport.seek': 'Reading position',

    'status.idle': 'Ready',
    'status.empty': 'Add some text to start.',
    'status.ready': ({ n }) => `Ready, ${n} ${n === 1 ? 'sentence' : 'sentences'}.`,
    'status.speaking': ({ i, n }) => `Reading sentence ${i} of ${n}.`,
    'status.paused': ({ i, n }) => `Paused at sentence ${i} of ${n}.`,
    'status.done': 'Reached the end of the text.',

    'meta.counts': ({ words, chars, duration }) =>
      `${words} ${words === 1 ? 'word' : 'words'}, ${chars} ${chars === 1 ? 'character' : 'characters'}, about ${duration}`,
    'meta.empty': 'No text yet.',

    'footer.note': 'Your text stays on this device. Voxpad sends nothing to a server.',
    'footer.nav': 'Footer',
    'footer.privacy': 'Privacy and data',
    'footer.shortcuts': 'Keyboard shortcuts',

    'shortcuts.title': 'Keyboard shortcuts',
    'shortcuts.space': 'Play or pause (when the text box is not focused)',
    'shortcuts.esc': 'Stop',
    'shortcuts.arrows': 'Previous or next sentence',
    'shortcuts.ctrlEnter': 'Read from the beginning',
    'shortcuts.question': 'Open this list',

    'drop.hint': 'Drop a text file to load it',

    'error.unsupported': 'This browser has no speech synthesis support, so playback is turned off. Recent versions of Chrome, Edge, Safari and Firefox all work.',
    'error.speech': ({ error }) => `The speech engine stopped with an error: ${error}.`,
    'error.fileType': 'That file is not plain text. Use .txt or .md.',
    'error.fileSize': 'That file is larger than 1 MB. Paste a smaller excerpt instead.',
    'error.fileRead': 'The file could not be read.',
  },

  el: {
    'tagline': 'Κείμενο σε ομιλία, τοπικά στη συσκευή σου.',

    'ui.language': 'Γλώσσα διεπαφής',
    'ui.theme': 'Θέμα',
    'ui.themeToDark': 'Αλλαγή σε σκούρο θέμα',
    'ui.themeToLight': 'Αλλαγή σε φωτεινό θέμα',
    'ui.close': 'Κλείσιμο',

    'doc.heading': 'Το κείμενό σου',
    'doc.tabs': 'Προβολή κειμένου',
    'doc.label': 'Κείμενο προς ανάγνωση',
    'doc.placeholder': 'Επικόλλησε εδώ το κείμενό σου, ή σύρε ένα αρχείο .txt οπουδήποτε στη σελίδα.',

    'tab.edit': 'Σύνταξη',
    'tab.read': 'Ανάγνωση',

    'tool.import': 'Άνοιγμα αρχείου',
    'tool.sample': 'Δείγμα',
    'tool.clear': 'Καθαρισμός',
    'tool.clearConfirm': 'Επιβεβαίωση',

    'reader.label': 'Κείμενο που διαβάζεται',
    'reader.empty': 'Δεν υπάρχει κείμενο ακόμη. Πρόσθεσέ το στην καρτέλα Σύνταξη.',
    'reader.hint': 'Πάτησε σε οποιαδήποτε πρόταση για να ξεκινήσει η ανάγνωση από εκεί.',

    'voice.heading': 'Φωνή',
    'voice.language': 'Γλώσσα',
    'voice.allLanguages': 'Όλες οι γλώσσες',
    'voice.voice': 'Φωνή',
    'voice.useMatch': 'Εφαρμογή',
    'voice.none': 'Δεν βρέθηκαν εγκατεστημένες φωνές σε αυτόν τον browser.',
    'voice.local': 'Τρέχει τοπικά, χωρίς σύνδεση στο διαδίκτυο.',
    'voice.network': 'Παράγεται από τον πάροχο του browser μέσω δικτύου.',
    'voice.hint': ({ script }) => `Το κείμενο είναι στα ${script}. Να μπει αντίστοιχη φωνή;`,
    'voice.count': ({ n }) => `${n} ${n === 1 ? 'διαθέσιμη φωνή' : 'διαθέσιμες φωνές'}.`,

    'delivery.heading': 'Απόδοση',
    'delivery.rate': 'Ταχύτητα',
    'delivery.pitch': 'Τόνος',
    'delivery.volume': 'Ένταση',
    'delivery.reset': 'Επαναφορά',

    'preset.group': 'Προεπιλογές ταχύτητας',
    'preset.slow': 'Αργά',
    'preset.normal': 'Κανονικά',
    'preset.brisk': 'Γρήγορα',

    'transport.prev': 'Προηγούμενη πρόταση',
    'transport.play': 'Αναπαραγωγή',
    'transport.pause': 'Παύση',
    'transport.resume': 'Συνέχεια',
    'transport.stop': 'Διακοπή',
    'transport.next': 'Επόμενη πρόταση',
    'transport.seek': 'Θέση ανάγνωσης',

    'status.idle': 'Έτοιμο',
    'status.empty': 'Πρόσθεσε κείμενο για να ξεκινήσεις.',
    'status.ready': ({ n }) => `Έτοιμο, ${n} ${n === 1 ? 'πρόταση' : 'προτάσεις'}.`,
    'status.speaking': ({ i, n }) => `Διαβάζει την πρόταση ${i} από ${n}.`,
    'status.paused': ({ i, n }) => `Παύση στην πρόταση ${i} από ${n}.`,
    'status.done': 'Έφτασε στο τέλος του κειμένου.',

    'meta.counts': ({ words, chars, duration }) =>
      `${words} ${words === 1 ? 'λέξη' : 'λέξεις'}, ${chars} ${chars === 1 ? 'χαρακτήρας' : 'χαρακτήρες'}, περίπου ${duration}`,
    'meta.empty': 'Δεν υπάρχει κείμενο ακόμη.',

    'footer.note': 'Το κείμενό σου μένει στη συσκευή σου. Το Voxpad δεν στέλνει τίποτα σε server.',
    'footer.nav': 'Υποσέλιδο',
    'footer.privacy': 'Απόρρητο και δεδομένα',
    'footer.shortcuts': 'Συντομεύσεις πληκτρολογίου',

    'shortcuts.title': 'Συντομεύσεις πληκτρολογίου',
    'shortcuts.space': 'Αναπαραγωγή ή παύση (όταν δεν γράφεις στο πλαίσιο κειμένου)',
    'shortcuts.esc': 'Διακοπή',
    'shortcuts.arrows': 'Προηγούμενη ή επόμενη πρόταση',
    'shortcuts.ctrlEnter': 'Ανάγνωση από την αρχή',
    'shortcuts.question': 'Άνοιγμα αυτής της λίστας',

    'drop.hint': 'Άφησε ένα αρχείο κειμένου για να φορτωθεί',

    'error.unsupported': 'Αυτός ο browser δεν υποστηρίζει σύνθεση ομιλίας, οπότε η αναπαραγωγή είναι απενεργοποιημένη. Πρόσφατες εκδόσεις των Chrome, Edge, Safari και Firefox λειτουργούν.',
    'error.speech': ({ error }) => `Η μηχανή ομιλίας σταμάτησε με σφάλμα: ${error}.`,
    'error.fileType': 'Το αρχείο δεν είναι απλό κείμενο. Χρησιμοποίησε .txt ή .md.',
    'error.fileSize': 'Το αρχείο ξεπερνά το 1 MB. Επικόλλησε ένα μικρότερο απόσπασμα.',
    'error.fileRead': 'Το αρχείο δεν μπόρεσε να διαβαστεί.',
  },
};

const SAMPLES = {
  en: 'Voxpad reads text out loud with the speech engine that ships inside your browser. Nothing is uploaded, so the text you paste stays in this tab.\n\nTry changing the voice and the speed while it reads. The sentence being spoken is highlighted as it goes, and you can click any sentence to jump straight to it.',
  el: 'Το Voxpad διαβάζει κείμενο δυνατά, με τη μηχανή ομιλίας που είναι ήδη μέσα στον browser σου. Τίποτα δεν ανεβαίνει κάπου, οπότε το κείμενο μένει σε αυτή την καρτέλα.\n\nΔοκίμασε να αλλάξεις φωνή και ταχύτητα ενώ διαβάζει. Η πρόταση που ακούγεται φωτίζεται καθώς προχωρά, και μπορείς να πατήσεις οποιαδήποτε πρόταση για να πας κατευθείαν εκεί.',
};

export const LANGUAGES = ['en', 'el'];

let current = 'en';

export function setLanguage(lang) {
  current = LANGUAGES.includes(lang) ? lang : 'en';
  document.documentElement.lang = current;
  return current;
}

export const getLanguage = () => current;

/** Picks a starting language from the browser, defaulting to English. */
export function detectLanguage() {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
  for (const tag of tags) {
    const primary = String(tag).split('-')[0].toLowerCase();
    if (LANGUAGES.includes(primary)) return primary;
  }
  return 'en';
}

export function t(key, vars) {
  const value = STRINGS[current][key] ?? STRINGS.en[key];
  if (value === undefined) return key;
  return typeof value === 'function' ? value(vars || {}) : value;
}

export const sampleText = () => SAMPLES[current] || SAMPLES.en;

export const scriptName = (script) => SCRIPTS[current]?.[script] || script;

/** Rewrites every element carrying a translation attribute. */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
}
