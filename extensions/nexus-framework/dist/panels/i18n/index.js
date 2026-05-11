"use strict";
const DEFAULT_LANGUAGE = 'zh_CN';
let draft = {
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
function setDraftFromState(state) {
    const languages = normalizeLanguages(state.languages);
    draft = {
        bundleName: state.bundleName || '',
        editorLanguage: languages.includes(state.editorLanguage) ? state.editorLanguage : languages[0],
        languages,
    };
}
function render($) {
    if ($.list) {
        $.list.innerHTML = '';
        draft.languages.forEach((language, index) => {
            var _a;
            (_a = $.list) === null || _a === void 0 ? void 0 : _a.appendChild(createLanguageRow($, language, index));
        });
    }
    if ($.current) {
        $.current.textContent = `${draft.editorLanguage || DEFAULT_LANGUAGE} / ${draft.bundleName || 'no bundle'}`;
    }
}
function createLanguageRow($, language, index) {
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
async function saveNow($) {
    const languages = normalizeLanguages(draft.languages);
    draft.languages = languages;
    if (!draft.editorLanguage || !languages.includes(draft.editorLanguage)) {
        draft.editorLanguage = languages[0];
    }
    const state = await Editor.Message.request('nexus-framework', 'set-i18n-languages', languages, draft.editorLanguage);
    setDraftFromState(state);
    render($);
}
function normalizeLanguages(languages) {
    const values = languages
        .map((language) => language.trim())
        .filter(Boolean);
    const uniqueValues = values.filter((language, index) => values.indexOf(language) === index);
    return uniqueValues.length > 0 ? uniqueValues : [DEFAULT_LANGUAGE];
}
function nextLanguageName() {
    let index = 1;
    let value = `lang_${index}`;
    while (draft.languages.includes(value)) {
        index++;
        value = `lang_${index}`;
    }
    return value;
}
module.exports = Editor.Panel.define({
    template,
    style,
    $: {
        root: '.i18n-panel',
        add: '.add',
        list: '.list',
        current: '.current',
    },
    async ready() {
        var _a;
        const refreshState = async () => {
            const state = await Editor.Message.request('nexus-framework', 'query-i18n-panel-state');
            setDraftFromState(state);
            render(this.$);
        };
        (_a = this.$.add) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => {
            draft.languages.push(nextLanguageName());
            draft.editorLanguage = draft.languages[draft.languages.length - 1];
            render(this.$);
            void saveNow(this.$);
        });
        await refreshState();
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zb3VyY2UvcGFuZWxzL2kxOG4vaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQW1CQSxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQztBQUNqQyxJQUFJLEtBQUssR0FBZTtJQUNwQixVQUFVLEVBQUUsRUFBRTtJQUNkLGNBQWMsRUFBRSxnQkFBZ0I7SUFDaEMsU0FBUyxFQUFFLENBQUMsZ0JBQWdCLENBQUM7Q0FDaEMsQ0FBQztBQUVGLE1BQU0sUUFBUSxHQUFHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Q0FxQmhCLENBQUM7QUFFRixNQUFNLEtBQUssR0FBRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0NBbUdiLENBQUM7QUE2QkYsU0FBUyxpQkFBaUIsQ0FBQyxLQUFxQjtJQUM1QyxNQUFNLFNBQVMsR0FBRyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDdEQsS0FBSyxHQUFHO1FBQ0osVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVLElBQUksRUFBRTtRQUNsQyxjQUFjLEVBQUUsU0FBUyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7UUFDOUYsU0FBUztLQUNaLENBQUM7QUFDTixDQUFDO0FBRUQsU0FBUyxNQUFNLENBQUMsQ0FBZ0I7SUFDNUIsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDVCxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsR0FBRyxFQUFFLENBQUM7UUFDdEIsS0FBSyxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxRQUFRLEVBQUUsS0FB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O0tBQ3RCO0lBQ0QsS0FBSyxDQUFDLEtBQUs7O1FBQ1AsTUFBTSxZQUFZLEdBQUcsS0FBSyxJQUFJLEVBQUU7WUFDNUIsTUFBTSxLQUFLLEdBQUcsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsRUFBRSx3QkFBd0IsQ0FBbUIsQ0FBQztZQUMxRyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUN6QixNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ25CLENBQUMsQ0FBQztRQUVGLE1BQUEsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLDBDQUFFLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxHQUFHLEVBQUU7WUFDdkMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDO1lBQ3pDLEtBQUssQ0FBQyxjQUFjLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQztZQUNuRSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2YsS0FBSyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3pCLENBQUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxZQUFZLEVBQUUsQ0FBQztJQUN6QixDQUFDO0NBQ0osQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsidHlwZSBQYW5lbFNlbGVjdG9yID0ge1xuICAgIHJvb3Q6IEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgICBhZGQ6IEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgICBsaXN0OiBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgY3VycmVudDogSFRNTEVsZW1lbnQgfCBudWxsO1xufTtcblxudHlwZSBJMThuUGFuZWxTdGF0ZSA9IHtcbiAgICBidW5kbGVOYW1lOiBzdHJpbmc7XG4gICAgZWRpdG9yTGFuZ3VhZ2U6IHN0cmluZztcbiAgICBsYW5ndWFnZXM6IHN0cmluZ1tdO1xufTtcblxudHlwZSBEcmFmdFN0YXRlID0ge1xuICAgIGJ1bmRsZU5hbWU6IHN0cmluZztcbiAgICBlZGl0b3JMYW5ndWFnZTogc3RyaW5nO1xuICAgIGxhbmd1YWdlczogc3RyaW5nW107XG59O1xuXG5jb25zdCBERUZBVUxUX0xBTkdVQUdFID0gJ3poX0NOJztcbmxldCBkcmFmdDogRHJhZnRTdGF0ZSA9IHtcbiAgICBidW5kbGVOYW1lOiAnJyxcbiAgICBlZGl0b3JMYW5ndWFnZTogREVGQVVMVF9MQU5HVUFHRSxcbiAgICBsYW5ndWFnZXM6IFtERUZBVUxUX0xBTkdVQUdFXSxcbn07XG5cbmNvbnN0IHRlbXBsYXRlID0gYFxuPHNlY3Rpb24gY2xhc3M9XCJpMThuLXBhbmVsXCI+XG4gICAgPGhlYWRlcj5cbiAgICAgICAgPGRpdj5cbiAgICAgICAgICAgIDxoMT5pMThuPC9oMT5cbiAgICAgICAgICAgIDxwPkVkaXRvciBwcmV2aWV3IGxhbmd1YWdlIGZvciBvcGVuZWQgc2NlbmVzIGFuZCBwcmVmYWJzLjwvcD5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJhZGRcIiB0aXRsZT1cIkFkZCBsYW5ndWFnZVwiPis8L2J1dHRvbj5cbiAgICA8L2hlYWRlcj5cbiAgICA8bWFpbj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImxpc3RcIj48L2Rpdj5cbiAgICAgICAgPGRpdiBjbGFzcz1cInJvd1wiPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJsYWJlbFwiPkRpcmVjdG9yeTwvc3Bhbj5cbiAgICAgICAgICAgIDxjb2RlPmFzc2V0cy9sYW5ndWFnZXMve2xhbmd1YWdlfS97YnVuZGxlfTwvY29kZT5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJyb3dcIj5cbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwibGFiZWxcIj5DdXJyZW50PC9zcGFuPlxuICAgICAgICAgICAgPGNvZGUgY2xhc3M9XCJjdXJyZW50XCI+V2FpdGluZyBmb3Igc2NlbmUgc3luYy4uLjwvY29kZT5cbiAgICAgICAgPC9kaXY+XG4gICAgPC9tYWluPlxuPC9zZWN0aW9uPlxuYDtcblxuY29uc3Qgc3R5bGUgPSBgXG4uaTE4bi1wYW5lbCB7XG4gICAgYm94LXNpemluZzogYm9yZGVyLWJveDtcbiAgICBoZWlnaHQ6IDEwMCU7XG4gICAgcGFkZGluZzogMTZweDtcbiAgICBjb2xvcjogdmFyKC0tY29sb3Itbm9ybWFsLWNvbnRyYXN0KTtcbiAgICBiYWNrZ3JvdW5kOiB2YXIoLS1jb2xvci1ub3JtYWwtZmlsbCk7XG4gICAgZm9udDogMTNweC8xLjUgc2Fucy1zZXJpZjtcbn1cblxuaGVhZGVyIHtcbiAgICBkaXNwbGF5OiBncmlkO1xuICAgIGdyaWQtdGVtcGxhdGUtY29sdW1uczogMWZyIGF1dG87XG4gICAgZ2FwOiAxMnB4O1xuICAgIGFsaWduLWl0ZW1zOiBzdGFydDtcbiAgICBtYXJnaW4tYm90dG9tOiAxNHB4O1xufVxuXG5oMSB7XG4gICAgbWFyZ2luOiAwIDAgNHB4O1xuICAgIGZvbnQtc2l6ZTogMThweDtcbiAgICBmb250LXdlaWdodDogNjAwO1xufVxuXG5wIHtcbiAgICBtYXJnaW46IDA7XG4gICAgY29sb3I6IHZhcigtLWNvbG9yLW5vcm1hbC1jb250cmFzdC13ZWFrZXN0KTtcbn1cblxuLmFkZCB7XG4gICAgd2lkdGg6IDI4cHg7XG4gICAgaGVpZ2h0OiAyOHB4O1xuICAgIHBhZGRpbmc6IDA7XG4gICAgZm9udC1zaXplOiAxOHB4O1xuICAgIGxpbmUtaGVpZ2h0OiAyNnB4O1xufVxuXG4ubGlzdCB7XG4gICAgZGlzcGxheTogZ3JpZDtcbiAgICBnYXA6IDZweDtcbiAgICBtYXJnaW4tYm90dG9tOiAxNHB4O1xufVxuXG4ubGFuZ3VhZ2Utcm93IHtcbiAgICBkaXNwbGF5OiBncmlkO1xuICAgIGdyaWQtdGVtcGxhdGUtY29sdW1uczogMjRweCBtaW5tYXgoMTIwcHgsIDFmcikgMjhweDtcbiAgICBnYXA6IDhweDtcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xufVxuXG4ubGFuZ3VhZ2UtcmFkaW8ge1xuICAgIGp1c3RpZnktc2VsZjogY2VudGVyO1xufVxuXG4ubGFuZ3VhZ2UtaW5wdXQge1xuICAgIGJveC1zaXppbmc6IGJvcmRlci1ib3g7XG4gICAgbWluLXdpZHRoOiAwO1xuICAgIGhlaWdodDogMjhweDtcbiAgICBwYWRkaW5nOiAwIDhweDtcbiAgICBjb2xvcjogdmFyKC0tY29sb3Itbm9ybWFsLWNvbnRyYXN0KTtcbiAgICBiYWNrZ3JvdW5kOiB2YXIoLS1jb2xvci1ub3JtYWwtZmlsbC1pbXBvcnRhbnQpO1xuICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWNvbG9yLW5vcm1hbC1ib3JkZXIpO1xuICAgIGJvcmRlci1yYWRpdXM6IDNweDtcbn1cblxuLmxhbmd1YWdlLWRlbGV0ZSB7XG4gICAgd2lkdGg6IDI4cHg7XG4gICAgaGVpZ2h0OiAyOHB4O1xuICAgIHBhZGRpbmc6IDA7XG59XG5cbi5yb3cge1xuICAgIGRpc3BsYXk6IGdyaWQ7XG4gICAgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiA4OHB4IDFmcjtcbiAgICBnYXA6IDEycHg7XG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgICBwYWRkaW5nOiAxMHB4IDA7XG4gICAgYm9yZGVyLXRvcDogMXB4IHNvbGlkIHZhcigtLWNvbG9yLW5vcm1hbC1ib3JkZXIpO1xufVxuXG4ubGFiZWwge1xuICAgIGNvbG9yOiB2YXIoLS1jb2xvci1ub3JtYWwtY29udHJhc3Qtd2Vha2VyKTtcbn1cblxuYnV0dG9uIHtcbiAgICBjb2xvcjogdmFyKC0tY29sb3Itbm9ybWFsLWNvbnRyYXN0KTtcbiAgICBiYWNrZ3JvdW5kOiB2YXIoLS1jb2xvci1ub3JtYWwtZmlsbC1lbXBoYXNpcyk7XG4gICAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tY29sb3Itbm9ybWFsLWJvcmRlcik7XG4gICAgYm9yZGVyLXJhZGl1czogM3B4O1xufVxuXG5idXR0b246ZGlzYWJsZWQge1xuICAgIG9wYWNpdHk6IDAuNDU7XG59XG5cbmNvZGUge1xuICAgIG92ZXJmbG93LXdyYXA6IGFueXdoZXJlO1xuICAgIGNvbG9yOiB2YXIoLS1jb2xvci1wcmltYXJ5LWZpbGwpO1xufVxuYDtcblxuZXhwb3J0ID0gRWRpdG9yLlBhbmVsLmRlZmluZSh7XG4gICAgdGVtcGxhdGUsXG4gICAgc3R5bGUsXG4gICAgJDoge1xuICAgICAgICByb290OiAnLmkxOG4tcGFuZWwnLFxuICAgICAgICBhZGQ6ICcuYWRkJyxcbiAgICAgICAgbGlzdDogJy5saXN0JyxcbiAgICAgICAgY3VycmVudDogJy5jdXJyZW50JyxcbiAgICB9LFxuICAgIGFzeW5jIHJlYWR5KCkge1xuICAgICAgICBjb25zdCByZWZyZXNoU3RhdGUgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ25leHVzLWZyYW1ld29yaycsICdxdWVyeS1pMThuLXBhbmVsLXN0YXRlJykgYXMgSTE4blBhbmVsU3RhdGU7XG4gICAgICAgICAgICBzZXREcmFmdEZyb21TdGF0ZShzdGF0ZSk7XG4gICAgICAgICAgICByZW5kZXIodGhpcy4kKTtcbiAgICAgICAgfTtcblxuICAgICAgICB0aGlzLiQuYWRkPy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAgICAgICAgIGRyYWZ0Lmxhbmd1YWdlcy5wdXNoKG5leHRMYW5ndWFnZU5hbWUoKSk7XG4gICAgICAgICAgICBkcmFmdC5lZGl0b3JMYW5ndWFnZSA9IGRyYWZ0Lmxhbmd1YWdlc1tkcmFmdC5sYW5ndWFnZXMubGVuZ3RoIC0gMV07XG4gICAgICAgICAgICByZW5kZXIodGhpcy4kKTtcbiAgICAgICAgICAgIHZvaWQgc2F2ZU5vdyh0aGlzLiQpO1xuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCByZWZyZXNoU3RhdGUoKTtcbiAgICB9LFxufSk7XG5cbmZ1bmN0aW9uIHNldERyYWZ0RnJvbVN0YXRlKHN0YXRlOiBJMThuUGFuZWxTdGF0ZSk6IHZvaWQge1xuICAgIGNvbnN0IGxhbmd1YWdlcyA9IG5vcm1hbGl6ZUxhbmd1YWdlcyhzdGF0ZS5sYW5ndWFnZXMpO1xuICAgIGRyYWZ0ID0ge1xuICAgICAgICBidW5kbGVOYW1lOiBzdGF0ZS5idW5kbGVOYW1lIHx8ICcnLFxuICAgICAgICBlZGl0b3JMYW5ndWFnZTogbGFuZ3VhZ2VzLmluY2x1ZGVzKHN0YXRlLmVkaXRvckxhbmd1YWdlKSA/IHN0YXRlLmVkaXRvckxhbmd1YWdlIDogbGFuZ3VhZ2VzWzBdLFxuICAgICAgICBsYW5ndWFnZXMsXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyKCQ6IFBhbmVsU2VsZWN0b3IpOiB2b2lkIHtcbiAgICBpZiAoJC5saXN0KSB7XG4gICAgICAgICQubGlzdC5pbm5lckhUTUwgPSAnJztcbiAgICAgICAgZHJhZnQubGFuZ3VhZ2VzLmZvckVhY2goKGxhbmd1YWdlLCBpbmRleCkgPT4ge1xuICAgICAgICAgICAgJC5saXN0Py5hcHBlbmRDaGlsZChjcmVhdGVMYW5ndWFnZVJvdygkLCBsYW5ndWFnZSwgaW5kZXgpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKCQuY3VycmVudCkge1xuICAgICAgICAkLmN1cnJlbnQudGV4dENvbnRlbnQgPSBgJHtkcmFmdC5lZGl0b3JMYW5ndWFnZSB8fCBERUZBVUxUX0xBTkdVQUdFfSAvICR7ZHJhZnQuYnVuZGxlTmFtZSB8fCAnbm8gYnVuZGxlJ31gO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlTGFuZ3VhZ2VSb3coJDogUGFuZWxTZWxlY3RvciwgbGFuZ3VhZ2U6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICByb3cuY2xhc3NOYW1lID0gJ2xhbmd1YWdlLXJvdyc7XG5cbiAgICBjb25zdCByYWRpbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lucHV0Jyk7XG4gICAgcmFkaW8uY2xhc3NOYW1lID0gJ2xhbmd1YWdlLXJhZGlvJztcbiAgICByYWRpby50eXBlID0gJ3JhZGlvJztcbiAgICByYWRpby5uYW1lID0gJ2VkaXRvci1sYW5ndWFnZSc7XG4gICAgcmFkaW8uY2hlY2tlZCA9IGRyYWZ0LmVkaXRvckxhbmd1YWdlID09PSBsYW5ndWFnZTtcbiAgICByYWRpby5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoKSA9PiB7XG4gICAgICAgIGRyYWZ0LmVkaXRvckxhbmd1YWdlID0gZHJhZnQubGFuZ3VhZ2VzW2luZGV4XSB8fCBERUZBVUxUX0xBTkdVQUdFO1xuICAgICAgICByZW5kZXIoJCk7XG4gICAgICAgIHZvaWQgc2F2ZU5vdygkKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGlucHV0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW5wdXQnKTtcbiAgICBpbnB1dC5jbGFzc05hbWUgPSAnbGFuZ3VhZ2UtaW5wdXQnO1xuICAgIGlucHV0LnZhbHVlID0gbGFuZ3VhZ2U7XG4gICAgaW5wdXQuc3BlbGxjaGVjayA9IGZhbHNlO1xuICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2lucHV0JywgKCkgPT4ge1xuICAgICAgICBjb25zdCBvbGRMYW5ndWFnZSA9IGRyYWZ0Lmxhbmd1YWdlc1tpbmRleF07XG4gICAgICAgIGNvbnN0IG5leHRMYW5ndWFnZSA9IGlucHV0LnZhbHVlLnRyaW0oKTtcbiAgICAgICAgZHJhZnQubGFuZ3VhZ2VzW2luZGV4XSA9IG5leHRMYW5ndWFnZTtcbiAgICAgICAgaWYgKGRyYWZ0LmVkaXRvckxhbmd1YWdlID09PSBvbGRMYW5ndWFnZSkge1xuICAgICAgICAgICAgZHJhZnQuZWRpdG9yTGFuZ3VhZ2UgPSBuZXh0TGFuZ3VhZ2U7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKCdibHVyJywgKCkgPT4ge1xuICAgICAgICB2b2lkIHNhdmVOb3coJCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCByZW1vdmUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgICByZW1vdmUuY2xhc3NOYW1lID0gJ2xhbmd1YWdlLWRlbGV0ZSc7XG4gICAgcmVtb3ZlLnRleHRDb250ZW50ID0gJy0nO1xuICAgIHJlbW92ZS50aXRsZSA9ICdSZW1vdmUgbGFuZ3VhZ2UnO1xuICAgIHJlbW92ZS5kaXNhYmxlZCA9IGRyYWZ0Lmxhbmd1YWdlcy5sZW5ndGggPD0gMTtcbiAgICByZW1vdmUuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlbW92ZWQgPSBkcmFmdC5sYW5ndWFnZXNbaW5kZXhdO1xuICAgICAgICBkcmFmdC5sYW5ndWFnZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgZHJhZnQubGFuZ3VhZ2VzID0gbm9ybWFsaXplTGFuZ3VhZ2VzKGRyYWZ0Lmxhbmd1YWdlcyk7XG4gICAgICAgIGlmIChkcmFmdC5lZGl0b3JMYW5ndWFnZSA9PT0gcmVtb3ZlZCB8fCAhZHJhZnQubGFuZ3VhZ2VzLmluY2x1ZGVzKGRyYWZ0LmVkaXRvckxhbmd1YWdlKSkge1xuICAgICAgICAgICAgZHJhZnQuZWRpdG9yTGFuZ3VhZ2UgPSBkcmFmdC5sYW5ndWFnZXNbMF07XG4gICAgICAgIH1cbiAgICAgICAgcmVuZGVyKCQpO1xuICAgICAgICB2b2lkIHNhdmVOb3coJCk7XG4gICAgfSk7XG5cbiAgICByb3cuYXBwZW5kQ2hpbGQocmFkaW8pO1xuICAgIHJvdy5hcHBlbmRDaGlsZChpbnB1dCk7XG4gICAgcm93LmFwcGVuZENoaWxkKHJlbW92ZSk7XG4gICAgcmV0dXJuIHJvdztcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2F2ZU5vdygkOiBQYW5lbFNlbGVjdG9yKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbGFuZ3VhZ2VzID0gbm9ybWFsaXplTGFuZ3VhZ2VzKGRyYWZ0Lmxhbmd1YWdlcyk7XG4gICAgZHJhZnQubGFuZ3VhZ2VzID0gbGFuZ3VhZ2VzO1xuICAgIGlmICghZHJhZnQuZWRpdG9yTGFuZ3VhZ2UgfHwgIWxhbmd1YWdlcy5pbmNsdWRlcyhkcmFmdC5lZGl0b3JMYW5ndWFnZSkpIHtcbiAgICAgICAgZHJhZnQuZWRpdG9yTGFuZ3VhZ2UgPSBsYW5ndWFnZXNbMF07XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KFxuICAgICAgICAnbmV4dXMtZnJhbWV3b3JrJyxcbiAgICAgICAgJ3NldC1pMThuLWxhbmd1YWdlcycsXG4gICAgICAgIGxhbmd1YWdlcyxcbiAgICAgICAgZHJhZnQuZWRpdG9yTGFuZ3VhZ2UsXG4gICAgKSBhcyBJMThuUGFuZWxTdGF0ZTtcbiAgICBzZXREcmFmdEZyb21TdGF0ZShzdGF0ZSk7XG4gICAgcmVuZGVyKCQpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVMYW5ndWFnZXMobGFuZ3VhZ2VzOiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCB2YWx1ZXMgPSBsYW5ndWFnZXNcbiAgICAgICAgLm1hcCgobGFuZ3VhZ2UpID0+IGxhbmd1YWdlLnRyaW0oKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICBjb25zdCB1bmlxdWVWYWx1ZXMgPSB2YWx1ZXMuZmlsdGVyKChsYW5ndWFnZSwgaW5kZXgpID0+IHZhbHVlcy5pbmRleE9mKGxhbmd1YWdlKSA9PT0gaW5kZXgpO1xuICAgIHJldHVybiB1bmlxdWVWYWx1ZXMubGVuZ3RoID4gMCA/IHVuaXF1ZVZhbHVlcyA6IFtERUZBVUxUX0xBTkdVQUdFXTtcbn1cblxuZnVuY3Rpb24gbmV4dExhbmd1YWdlTmFtZSgpOiBzdHJpbmcge1xuICAgIGxldCBpbmRleCA9IDE7XG4gICAgbGV0IHZhbHVlID0gYGxhbmdfJHtpbmRleH1gO1xuICAgIHdoaWxlIChkcmFmdC5sYW5ndWFnZXMuaW5jbHVkZXModmFsdWUpKSB7XG4gICAgICAgIGluZGV4Kys7XG4gICAgICAgIHZhbHVlID0gYGxhbmdfJHtpbmRleH1gO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG59XG4iXX0=