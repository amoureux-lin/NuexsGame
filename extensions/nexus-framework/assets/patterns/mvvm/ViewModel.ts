import { EditBox, Label, Node, ProgressBar, RichText, Sprite, SpriteFrame, Toggle } from 'cc';
import { Observable } from './Observable';

type Unsubscribe = () => void;

/**
 * MVVM — ViewModel 基类
 * 持有响应式数据，提供 bind* 系列方法将 Observable 与 Cocos 节点双向/单向绑定。
 * 调用 dispose() 统一释放所有绑定。
 */
export abstract class ViewModel {

    private readonly _disposers: Unsubscribe[] = [];

    /** 将 `Observable<string>` 单向绑定到 `Label.string`。 */
    bindLabel(obs: Observable<string>, label: Label): void {
        label.string = obs.value;
        this._disposers.push(obs.observe(v => { label.string = v; }));
    }

    /** 将 `Observable<string>` 单向绑定到 `RichText.string`。 */
    bindRichText(obs: Observable<string>, richText: RichText): void {
        richText.string = obs.value;
        this._disposers.push(obs.observe(v => { richText.string = v; }));
    }

    /** 将 `Observable<string>` 与 `EditBox.string` 做双向绑定。 */
    bindEditBox(obs: Observable<string>, editBox: EditBox): void {
        editBox.string = obs.value;
        const onEditEnded = () => {
            obs.value = editBox.string;
        };

        editBox.node.on(EditBox.EventType.EDITING_DID_ENDED, onEditEnded, this);
        this._disposers.push(() => editBox.node.off(EditBox.EventType.EDITING_DID_ENDED, onEditEnded, this));
        this._disposers.push(obs.observe(v => { editBox.string = v; }));
    }

    /** 将 `Observable<boolean>` 单向绑定到 `Node.active`。 */
    bindVisible(obs: Observable<boolean>, node: Node): void {
        node.active = obs.value;
        this._disposers.push(obs.observe(v => { node.active = v; }));
    }

    /** 将 `Observable<boolean>` 与 `Toggle.isChecked` 做双向绑定。 */
    bindToggle(obs: Observable<boolean>, toggle: Toggle): void {
        toggle.isChecked = obs.value;
        const onToggle = () => {
            obs.value = toggle.isChecked;
        };

        toggle.node.on(Toggle.EventType.TOGGLE, onToggle, this);
        this._disposers.push(() => toggle.node.off(Toggle.EventType.TOGGLE, onToggle, this));
        this._disposers.push(obs.observe(v => { toggle.isChecked = v; }));
    }

    /** 将 `Observable<number>` 单向绑定到 `ProgressBar.progress`。 */
    bindProgress(obs: Observable<number>, bar: ProgressBar): void {
        bar.progress = obs.value;
        this._disposers.push(obs.observe(v => { bar.progress = v; }));
    }

    /** 将 `Observable<SpriteFrame | null>` 单向绑定到 `Sprite.spriteFrame`。 */
    bindSprite(obs: Observable<SpriteFrame | null>, sprite: Sprite): void {
        sprite.spriteFrame = obs.value;
        this._disposers.push(obs.observe(v => { sprite.spriteFrame = v; }));
    }

    /** 释放当前 ViewModel 建立的全部绑定与事件监听。 */
    dispose(): void {
        for (const dispose of this._disposers) {
            dispose();
        }
        this._disposers.length = 0;
    }
}
