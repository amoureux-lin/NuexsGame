type PanelSelector = {
    root: HTMLElement | null;
    add: HTMLElement | null;
    list: HTMLElement | null;
    current: HTMLElement | null;
};

type I18nPanelState = {
    bundleName: string;
    editorLanguage: string;
    languages: string[];
};

type DraftState = {
    bundleName: string;
    editorLanguage: string;
    languages: string[];
};

const DEFAULT_LANGUAGE = 'zh_CN';
let draft: DraftState = {
    bundleName: '',
    editorLanguage: DEFAULT_LANGUAGE,
    languages: [DEFAULT_LANGUAGE],
};

const template = `
<section class="i18n-panel">
    <header>
        <div>
            <h1>i18n</h1>
            <p>Editor preview language for opened scenes and prefabs.</p>
        </div>
        <button class="add" title="Add language">+</button>
    </header>
    <main>
        <div class="list"></div>
        <div class="row">
            <span class="label">Directory</span>
            <code>assets/languages/{language}/{bundle}</code>
        </div>
        <div class="row">
            <span class="label">Current</span>
            <code class="current">Waiting for scene sync...</code>
        </div>
    </main>
</section>
`;

const style = `
.i18n-panel {
    box-sizing: border-box;
    height: 100%;
    padding: 16px;
    color: var(--color-normal-contrast);
    background: var(--color-normal-fill);
    font: 13px/1.5 sans-serif;
}

header {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: start;
    margin-bottom: 14px;
}

h1 {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 600;
}

p {
    margin: 0;
    color: var(--color-normal-contrast-weakest);
}

.add {
    width: 28px;
    height: 28px;
    padding: 0;
    font-size: 18px;
    line-height: 26px;
}

.list {
    display: grid;
    gap: 6px;
    margin-bottom: 14px;
}

.language-row {
    display: grid;
    grid-template-columns: 24px minmax(120px, 1fr) 28px;
    gap: 8px;
    align-items: center;
}

.language-radio {
    justify-self: center;
}

.language-input {
    box-sizing: border-box;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    color: var(--color-normal-contrast);
    background: var(--color-normal-fill-important);
    border: 1px solid var(--color-normal-border);
    border-radius: 3px;
}

.language-delete {
    width: 28px;
    height: 28px;
    padding: 0;
}

.row {
    display: grid;
    grid-template-columns: 88px 1fr;
    gap: 12px;
    align-items: center;
    padding: 10px 0;
    border-top: 1px solid var(--color-normal-border);
}

.label {
    color: var(--color-normal-contrast-weaker);
}

button {
    color: var(--color-normal-contrast);
    background: var(--color-normal-fill-emphasis);
    border: 1px solid var(--color-normal-border);
    border-radius: 3px;
}

button:disabled {
    opacity: 0.45;
}

code {
    overflow-wrap: anywhere;
    color: var(--color-primary-fill);
}
`;

export = Editor.Panel.define({
    template,
    style,
    $: {
        root: '.i18n-panel',
        add: '.add',
        list: '.list',
        current: '.current',
    },
    async ready() {
        const refreshState = async () => {
            const state = await Editor.Message.request('nexus-framework', 'query-i18n-panel-state') as I18nPanelState;
            setDraftFromState(state);
            render(this.$);
        };

        this.$.add?.addEventListener('click', () => {
            draft.languages.push(nextLanguageName());
            draft.editorLanguage = draft.languages[draft.languages.length - 1];
            render(this.$);
            void saveNow(this.$);
        });

        await refreshState();
    },
});

function setDraftFromState(state: I18nPanelState): void {
    const languages = normalizeLanguages(state.languages);
    draft = {
        bundleName: state.bundleName || '',
        editorLanguage: languages.includes(state.editorLanguage) ? state.editorLanguage : languages[0],
        languages,
    };
}

function render($: PanelSelector): void {
    if ($.list) {
        $.list.innerHTML = '';
        draft.languages.forEach((language, index) => {
            $.list?.appendChild(createLanguageRow($, language, index));
        });
    }

    if ($.current) {
        $.current.textContent = `${draft.editorLanguage || DEFAULT_LANGUAGE} / ${draft.bundleName || 'no bundle'}`;
    }
}

function createLanguageRow($: PanelSelector, language: string, index: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'language-row';

    const radio = document.createElement('input');
    radio.className = 'language-radio';
    radio.type = 'radio';
    radio.name = 'editor-language';
    radio.checked = draft.editorLanguage === language;
    radio.addEventListener('change', () => {
        draft.editorLanguage = draft.languages[index] || DEFAULT_LANGUAGE;
        render($);
        void saveNow($);
    });

    const input = document.createElement('input');
    input.className = 'language-input';
    input.value = language;
    input.spellcheck = false;
    input.addEventListener('input', () => {
        const oldLanguage = draft.languages[index];
        const nextLanguage = input.value.trim();
        draft.languages[index] = nextLanguage;
        if (draft.editorLanguage === oldLanguage) {
            draft.editorLanguage = nextLanguage;
        }
    });
    input.addEventListener('blur', () => {
        void saveNow($);
    });

    const remove = document.createElement('button');
    remove.className = 'language-delete';
    remove.textContent = '-';
    remove.title = 'Remove language';
    remove.disabled = draft.languages.length <= 1;
    remove.addEventListener('click', () => {
        const removed = draft.languages[index];
        draft.languages.splice(index, 1);
        draft.languages = normalizeLanguages(draft.languages);
        if (draft.editorLanguage === removed || !draft.languages.includes(draft.editorLanguage)) {
            draft.editorLanguage = draft.languages[0];
        }
        render($);
        void saveNow($);
    });

    row.appendChild(radio);
    row.appendChild(input);
    row.appendChild(remove);
    return row;
}

async function saveNow($: PanelSelector): Promise<void> {
    const languages = normalizeLanguages(draft.languages);
    draft.languages = languages;
    if (!draft.editorLanguage || !languages.includes(draft.editorLanguage)) {
        draft.editorLanguage = languages[0];
    }

    const state = await Editor.Message.request(
        'nexus-framework',
        'set-i18n-languages',
        languages,
        draft.editorLanguage,
    ) as I18nPanelState;
    setDraftFromState(state);
    render($);
}

function normalizeLanguages(languages: string[]): string[] {
    const values = languages
        .map((language) => language.trim())
        .filter(Boolean);
    const uniqueValues = values.filter((language, index) => values.indexOf(language) === index);
    return uniqueValues.length > 0 ? uniqueValues : [DEFAULT_LANGUAGE];
}

function nextLanguageName(): string {
    let index = 1;
    let value = `lang_${index}`;
    while (draft.languages.includes(value)) {
        index++;
        value = `lang_${index}`;
    }
    return value;
}
