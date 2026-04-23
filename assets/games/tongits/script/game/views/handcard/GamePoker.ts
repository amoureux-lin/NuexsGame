import { _decorator, Component,  SpriteAtlas, SpriteFrame } from 'cc';
const { ccclass, property } = _decorator;

const POKER_COLOR = {
    BLACK:100,  //黑
    RED:200,    //红
    FLOWER:300, //梅
    SLICE:400,  //方
}

@ccclass('GamePoker')
export class GamePoker extends Component {

    @property(SpriteFrame)
    pokerNormalBacks:SpriteFrame = null;              //牌背

    @property({type:SpriteAtlas})
    pokerAtlas:SpriteAtlas = null;

    /**
     * 获取牌
     * @param pokerNum 黑：A-K:101-113 红：A-K:201-213 梅：A-K:301-313 方：A-K:401-413
     */
    getCard(pokerNum:number) :SpriteFrame{
        return this.pokerAtlas.getSpriteFrame(pokerNum+"")
    }

    /**
     * 获取普通牌背
     */
    getNormalBack(){
        return this.pokerNormalBacks;
    }

}


