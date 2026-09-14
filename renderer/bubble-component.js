(function () {
  const template = document.createElement('template')
  template.innerHTML = `
    <style>
      :host {
        --bubble-width: 270px;
        --bubble-surface: linear-gradient(150deg, rgba(250, 252, 255, .97), rgba(229, 235, 255, .92) 58%, rgba(238, 233, 255, .92));
        --bubble-tail-surface: #edf0ff;
        --bubble-tail-edge: rgba(142, 128, 236, .62);
        --bubble-tail-highlight: rgba(255, 255, 255, .9);
        --bubble-tail-shadow: rgba(91, 79, 190, .2);
        --bubble-outline: rgba(250, 252, 255, .98);
        --bubble-ink: #33468d;
        --bubble-accent: #8d78f4;
        --bubble-hot: #f28bcf;
        --bubble-paw: #a691ff;
        --bubble-glow: rgba(140, 120, 255, .22);
        position: relative;
        display: block;
        box-sizing: border-box;
        width: var(--bubble-width);
        min-height: 74px;
        padding: 21px 23px 12px;
        color: var(--bubble-ink);
        font-family: "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
        font-size: 12.5px;
        font-weight: 520;
        line-height: 1.58;
        text-align: left;
        text-wrap: pretty;
        isolation: isolate;
      }

      :host([theme="healing"]) {
        --bubble-surface: linear-gradient(150deg, rgba(255, 254, 253, .99), rgba(255, 242, 249, .97) 58%, rgba(255, 235, 247, .96));
        --bubble-tail-surface: #fff0f8;
        --bubble-tail-edge: rgba(235, 105, 172, .78);
        --bubble-tail-highlight: rgba(255, 255, 255, .94);
        --bubble-tail-shadow: rgba(198, 68, 139, .2);
        --bubble-outline: rgba(255, 177, 219, .96);
        --bubble-ink: #56335d;
        --bubble-accent: #ef69ad;
        --bubble-hot: #f36eb4;
        --bubble-paw: #ed70b3;
        --bubble-glow: rgba(247, 105, 184, .3);
      }

      :host(.interaction-bubble-widget) {
        position: fixed;
        z-index: 4;
        top: 20px;
        left: 65px;
        max-width: calc(100% - 24px);
        opacity: 0;
        transform: translateY(6px) scale(.98);
        transform-origin: center bottom;
        transition: opacity 160ms ease, transform 180ms ease;
        pointer-events: none;
      }

      :host(.interaction-bubble-widget.is-visible) {
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      *, *::before, *::after { box-sizing: border-box; }

      .frame {
        position: absolute;
        z-index: 0;
        inset: 0;
        overflow: hidden;
        border: 1px solid var(--bubble-outline);
        border-radius: 18px;
        background: var(--bubble-surface);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, .92),
          inset 0 0 18px rgba(151, 169, 255, .12),
          0 7px 24px rgba(68, 91, 177, .2),
          0 0 20px var(--bubble-glow);
        -webkit-backdrop-filter: blur(18px) saturate(1.16);
        backdrop-filter: blur(18px) saturate(1.16);
      }

      .frame::before {
        position: absolute;
        inset: 2px;
        border-top: 1px solid rgba(255, 255, 255, .72);
        border-left: 1px solid rgba(255, 255, 255, .5);
        border-radius: 15px;
        content: "";
      }

      .frame::after {
        position: absolute;
        top: -36px;
        left: 24px;
        width: 150px;
        height: 58px;
        border-radius: 50%;
        background: rgba(255, 255, 255, .48);
        filter: blur(13px);
        content: "";
        transform: rotate(-7deg);
      }

      .message {
        position: relative;
        z-index: 2;
        display: -webkit-box;
        max-height: 4.74em;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }

      .message-expand {
        position: absolute;
        z-index: 10;
        right: 18px;
        bottom: 8px;
        display: none;
        min-height: 26px;
        padding: 2px 9px;
        border: 1px solid rgba(255, 255, 255, .7);
        border-radius: 13px;
        outline: none;
        background: rgba(245, 246, 255, .72);
        box-shadow:
          -14px 0 14px rgba(238, 241, 255, .82),
          inset 0 1px 0 rgba(255, 255, 255, .84);
        color: var(--bubble-accent);
        font: 700 12px/1.2 "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
        white-space: nowrap;
        cursor: pointer;
        pointer-events: auto;
        align-items: center;
        gap: 7px;
        transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 120ms ease;
      }

      .message-expand::after {
        width: 7px;
        height: 7px;
        margin-top: -4px;
        border-right: 1.7px solid currentColor;
        border-bottom: 1.7px solid currentColor;
        content: "";
        transform: rotate(45deg);
      }

      :host([expandable]) .message-expand:not([hidden]) {
        display: inline-flex;
      }

      .message-expand:hover {
        background: rgba(255, 255, 255, .88);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, .94),
          0 3px 10px rgba(104, 88, 205, .13);
      }

      .message-expand:active {
        transform: scale(.96);
      }

      .message-expand:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--bubble-accent) 46%, transparent);
        outline-offset: 2px;
      }

      :host([theme="healing"]) .message-expand {
        border-color: rgba(255, 190, 224, .76);
        background: rgba(255, 243, 250, .82);
        box-shadow:
          -14px 0 14px rgba(255, 240, 248, .88),
          inset 0 1px 0 rgba(255, 255, 255, .9);
        color: #e954a3;
      }

      :host([theme="healing"]) .message-expand:hover {
        background: rgba(255, 252, 253, .94);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, .96),
          0 3px 10px rgba(220, 80, 155, .14);
      }

      /* 长消息操作始终压在装饰层之上，并为最靠近按钮的装饰降噪，
         避免 sweet / pixel / sci-fi 的角标遮挡点击区域或按钮文字。 */
      :host([expandable]) .heart-secondary,
      :host([expandable]) .caret {
        opacity: .18;
      }

      :host([style-name="pixel"]) .message-expand {
        border-radius: 2px;
        background: rgba(245, 243, 255, .94);
        box-shadow: 2px 2px 0 rgba(104, 91, 203, .2);
      }

      :host([style-name="sci-fi"]) .message-expand {
        border-color: rgba(143, 185, 255, .66);
        border-radius: 6px 2px 6px 3px;
        background: rgba(238, 246, 255, .88);
        box-shadow: 0 0 8px rgba(94, 178, 255, .2);
      }

      .label {
        position: absolute;
        z-index: 7;
        top: -11px;
        left: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-width: 76px;
        height: 27px;
        padding: 0 14px 0 11px;
        border: 1px solid rgba(255, 255, 255, .9);
        border-radius: 14px 7px 14px 13px;
        background: linear-gradient(145deg, #b89afc, #7d75ed 72%);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, .45),
          0 4px 12px rgba(105, 88, 218, .32),
          0 0 13px rgba(161, 131, 255, .35);
        color: white;
        font-size: 13px;
        font-style: normal;
        font-weight: 750;
        line-height: 1;
        white-space: nowrap;
        transform: skewX(-9deg);
      }

      :host([source="external"]) .label {
        box-sizing: border-box;
        max-width: calc(100% - 93px);
      }

      :host([source="external"]) .label-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .label-text,
      .label-heart { transform: skewX(9deg); }

      .source-marker {
        position: absolute;
        z-index: 7;
        top: 7px;
        right: 16px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 0;
        background: transparent;
        box-shadow: none;
        color: var(--bubble-accent);
        font-size: 9.5px;
        font-style: normal;
        font-weight: 650;
        letter-spacing: .02em;
        line-height: 1;
        opacity: .62;
        pointer-events: none;
        white-space: nowrap;
      }

      .source-marker::before {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: currentColor;
        content: "";
      }

      .source-marker[hidden] { display: none; }

      /* 外部来源标识占用右上角时，让装饰线稿主动退让，保持信息安静可读。 */
      :host([source="external"]) :is(.sparkle-top, .hud-top) { display: none; }

      .label-heart {
        display: none;
        margin-left: -2px;
        font: inherit;
      }

      .paw {
        --paw-color: var(--bubble-paw);
        position: relative;
        display: block;
        width: 21px;
        height: 18px;
        color: var(--paw-color);
      }

      .paw::before,
      .paw::after {
        position: absolute;
        inset: 0;
        content: "";
      }

      .paw::before {
        background: radial-gradient(ellipse at 50% 78%, var(--paw-color) 0 27%, transparent 30%);
      }

      .paw::after {
        background:
          radial-gradient(ellipse at 13% 35%, var(--paw-color) 0 11%, transparent 13%),
          radial-gradient(ellipse at 38% 15%, var(--paw-color) 0 12%, transparent 14%),
          radial-gradient(ellipse at 67% 16%, var(--paw-color) 0 12%, transparent 14%),
          radial-gradient(ellipse at 91% 39%, var(--paw-color) 0 11%, transparent 13%);
      }

      .label-paw {
        --paw-color: #fff;
        width: 20px;
        height: 17px;
        margin-left: -2px;
        transform: skewX(9deg) rotate(-5deg);
      }

      .decor {
        position: absolute;
        z-index: 4;
        display: block;
        pointer-events: none;
      }

      .sparkle {
        color: rgba(255, 255, 255, .98);
        font-family: Georgia, serif;
        font-style: normal;
        line-height: 1;
        text-shadow: 0 0 8px rgba(255, 255, 255, .96), 0 0 13px rgba(147, 126, 255, .72);
      }

      .sparkle-top { top: 7px; right: 10px; font-size: 21px; }
      .sparkle-bottom { bottom: 6px; left: 12px; font-size: 14px; }
      .paw-primary { top: 34px; right: 6px; width: 24px; height: 21px; opacity: .42; transform: rotate(10deg); }
      .paw-secondary { display: none; }

      .heart,
      .heart-secondary {
        color: var(--bubble-accent);
        font-size: 15px;
        font-style: normal;
        line-height: 1;
        text-shadow: 0 0 8px rgba(141, 120, 244, .36);
      }

      .heart { right: 25px; bottom: 6px; }
      .heart-secondary { display: none; }

      .caret {
        right: 31px;
        bottom: 10px;
        display: none;
        width: 0;
        height: 0;
        border-top: 9px solid var(--bubble-hot);
        border-right: 7px solid transparent;
        border-left: 7px solid transparent;
      }

      .petal {
        width: 13px;
        height: 22px;
        border-radius: 80% 15% 75% 20%;
        background: linear-gradient(145deg, rgba(255, 184, 238, .96), rgba(245, 110, 200, .72));
        box-shadow: 0 0 9px rgba(255, 124, 210, .64);
      }

      .petal-left { top: 43px; left: -8px; transform: rotate(-43deg) scale(.8); }
      .petal-right { right: -7px; bottom: 7px; transform: rotate(38deg) scale(.72); }

      .ribbon {
        top: 40px;
        left: -7px;
        display: none;
        width: 18px;
        height: 14px;
      }

      .ribbon::before,
      .ribbon::after {
        position: absolute;
        top: 1px;
        width: 11px;
        height: 11px;
        border: 1px solid rgba(255, 255, 255, .65);
        border-radius: 70% 35% 65% 35%;
        background: linear-gradient(145deg, #ffb9e2, #ef69b0);
        box-shadow: 0 0 8px rgba(244, 91, 173, .5);
        content: "";
      }

      .ribbon::before { left: 0; transform: rotate(35deg); }
      .ribbon::after { right: 0; transform: rotate(-35deg); }

      .hud,
      .hud-copy,
      .hud-status {
        display: none;
      }

      .tail {
        position: absolute;
        z-index: 1;
        bottom: -11px;
        left: var(--bubble-tail-x, 50%);
        width: 21px;
        height: 13px;
        border: 0;
        background: var(--bubble-tail-surface);
        clip-path: polygon(0 0, 100% 0, 50% 100%);
        filter: drop-shadow(0 4px 3px rgba(76, 91, 174, .1));
        content: "";
        transform: translateX(-50%);
      }

      /* 治愈主题的基础玻璃款 */
      :host([theme="healing"]) {
        padding: 19px 22px 11px;
        font-size: 12px;
        font-weight: 540;
      }

      :host([theme="healing"]) .frame {
        border-radius: 18px;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, .9),
          inset 0 0 18px rgba(255, 194, 229, .2),
          0 7px 22px rgba(196, 82, 147, .2),
          0 0 20px var(--bubble-glow);
      }

      :host([theme="healing"]) .label {
        top: -12px;
        left: 16px;
        min-width: 82px;
        border-color: rgba(246, 136, 196, .9);
        border-radius: 15px;
        background: linear-gradient(145deg, rgba(255, 251, 253, .99), rgba(255, 226, 243, .98));
        color: #e94d9e;
        transform: none;
      }

      :host([theme="healing"]) .label-text,
      :host([theme="healing"]) .label-heart { transform: none; }
      :host([theme="healing"]) .label-paw { --paw-color: #eb62ab; transform: rotate(-6deg); }
      :host([theme="healing"]) .label-heart { display: block; }
      :host([theme="healing"]) .sparkle-top { top: 5px; right: auto; left: -6px; font-size: 18px; }
      :host([theme="healing"]) .sparkle-bottom { bottom: 5px; left: 5px; font-size: 12px; }
      :host([theme="healing"]) .paw-primary { top: auto; right: 5px; bottom: 7px; width: 27px; height: 23px; opacity: .9; }
      :host([theme="healing"]) .paw-secondary { top: 8px; right: -4px; display: block; width: 20px; height: 17px; opacity: .86; transform: rotate(20deg); }
      :host([theme="healing"]) .heart { top: -9px; right: 18px; bottom: auto; font-size: 18px; }
      :host([theme="healing"]) .caret { display: block; }
      :host([theme="healing"]) .petal-left { top: 47px; transform: rotate(-38deg) scale(.74); }
      :host([theme="healing"]) .petal-right { right: -6px; bottom: 17px; transform: rotate(36deg) scale(.64); }

      /* 甜美气泡：更圆、更柔，治愈主题额外带蝴蝶结和双爱心。 */
      :host([style-name="sweet"]) {
        --bubble-width: 264px;
        min-height: 78px;
        padding: 22px 43px 13px 24px;
      }

      :host([style-name="sweet"]) .frame {
        border-radius: 29px 31px 27px 30px;
        background: linear-gradient(145deg, rgba(255, 255, 255, .97), rgba(239, 236, 255, .93) 58%, rgba(252, 238, 255, .94));
        box-shadow:
          inset 0 0 16px rgba(255, 255, 255, .82),
          inset 0 -8px 20px rgba(181, 163, 255, .13),
          0 6px 21px rgba(105, 88, 190, .18),
          0 0 20px rgba(160, 133, 255, .22);
      }

      :host([style-name="sweet"]) .frame::before { border-radius: 26px; }
      :host([style-name="sweet"]) .label { border-radius: 16px; transform: none; }
      :host([style-name="sweet"]) .label-text,
      :host([style-name="sweet"]) .label-heart,
      :host([style-name="sweet"]) .label-paw { transform: none; }
      :host([style-name="sweet"]) .heart { top: -10px; right: 23px; bottom: auto; display: block; font-size: 21px; }
      :host([style-name="sweet"]) .heart-secondary { right: 35px; bottom: 7px; display: block; font-size: 18px; }
      :host([style-name="sweet"]) .paw-primary { right: 6px; bottom: 8px; top: auto; width: 28px; height: 24px; opacity: .78; }
      :host([style-name="sweet"]) .paw-secondary { top: 8px; right: -2px; display: block; width: 18px; height: 16px; opacity: .64; }
      :host([style-name="sweet"]) .caret { display: block; }

      :host([theme="healing"][style-name="sweet"]) {
        --bubble-outline: rgba(255, 153, 209, .97);
        --bubble-tail-surface: #fff2f9;
        min-height: 80px;
      }

      :host([theme="healing"][style-name="sweet"]) .frame {
        background: linear-gradient(145deg, rgba(255, 255, 255, .99), rgba(255, 239, 248, .98) 58%, rgba(255, 226, 244, .97));
        box-shadow:
          inset 0 0 16px rgba(255, 255, 255, .9),
          inset 0 -8px 20px rgba(255, 143, 204, .13),
          0 7px 20px rgba(213, 76, 153, .2),
          0 0 21px rgba(248, 83, 177, .31);
      }

      :host([theme="healing"][style-name="sweet"]) .ribbon { display: block; }
      :host([theme="healing"][style-name="sweet"]) .petal-left { display: none; }
      :host([theme="healing"][style-name="sweet"]) .petal-right { width: 17px; height: 17px; border-radius: 50% 50% 45% 50%; }

      /* 像素气泡：使用阶梯切角、硬边描线和方形阴影。 */
      :host([style-name="pixel"]) {
        --bubble-width: 270px;
        min-height: 76px;
        padding: 23px 35px 12px 25px;
        font-family: "Microsoft YaHei UI", monospace;
      }

      :host([style-name="pixel"]) .frame {
        overflow: visible;
        border: 0;
        border-radius: 0;
        background: #7c70e9;
        box-shadow: 5px 6px 0 rgba(106, 92, 207, .2), 0 0 12px rgba(123, 108, 238, .27);
        clip-path: polygon(9px 0, calc(100% - 9px) 0, calc(100% - 9px) 4px, 100% 4px, 100% calc(100% - 9px), calc(100% - 5px) calc(100% - 9px), calc(100% - 5px) 100%, 9px 100%, 9px calc(100% - 4px), 0 calc(100% - 4px), 0 9px, 4px 9px, 4px 4px, 9px 4px);
        filter: none;
      }

      :host([style-name="pixel"]) .frame::before {
        inset: 3px;
        border: 0;
        border-radius: 0;
        background:
          linear-gradient(rgba(255, 255, 255, .18) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, .18) 1px, transparent 1px),
          linear-gradient(150deg, #fff, #f3f4ff 66%, #ebe9ff);
        background-size: 4px 4px, 4px 4px, auto;
        clip-path: polygon(7px 0, calc(100% - 7px) 0, calc(100% - 7px) 4px, 100% 4px, 100% calc(100% - 7px), calc(100% - 4px) calc(100% - 7px), calc(100% - 4px) 100%, 7px 100%, 7px calc(100% - 4px), 0 calc(100% - 4px), 0 7px, 4px 7px, 4px 4px, 7px 4px);
        content: "";
      }

      :host([style-name="pixel"]) .frame::after { display: none; }
      :host([style-name="pixel"]) .label {
        top: -10px;
        left: 18px;
        height: 28px;
        border: 0;
        border-radius: 0;
        background: #786de7;
        box-shadow: 4px 4px 0 rgba(104, 91, 203, .22), inset 0 0 0 2px rgba(255, 255, 255, .28);
        clip-path: polygon(5px 0, calc(100% - 5px) 0, calc(100% - 5px) 3px, 100% 3px, 100% calc(100% - 5px), calc(100% - 5px) calc(100% - 5px), calc(100% - 5px) 100%, 5px 100%, 5px calc(100% - 3px), 0 calc(100% - 3px), 0 5px, 5px 5px);
        transform: none;
      }

      :host([style-name="pixel"]) .label-text,
      :host([style-name="pixel"]) .label-heart,
      :host([style-name="pixel"]) .label-paw { transform: none; }
      :host([style-name="pixel"]) .sparkle { text-shadow: none; }
      :host([style-name="pixel"]) .sparkle-top { top: -5px; right: -1px; font-size: 17px; }
      :host([style-name="pixel"]) .sparkle-bottom { bottom: -2px; left: 8px; }
      :host([style-name="pixel"]) .paw-primary { right: 8px; bottom: 8px; top: auto; opacity: .9; }
      :host([style-name="pixel"]) .paw-secondary { display: none; }
      :host([style-name="pixel"]) .heart { top: 7px; right: 10px; bottom: auto; font-size: 17px; text-shadow: none; }
      :host([style-name="pixel"]) .caret { display: block; bottom: 11px; }
      :host([style-name="pixel"]) .petal { width: 11px; height: 15px; border-radius: 0; clip-path: polygon(0 25%, 25% 25%, 25% 0, 75% 0, 75% 25%, 100% 25%, 100% 75%, 75% 75%, 75% 100%, 25% 100%, 25% 75%, 0 75%); filter: none; }
      :host([style-name="pixel"]) .tail {
        bottom: -10px;
        width: 19px;
        height: 14px;
        border: 0;
        background: #f1efff;
        clip-path: polygon(0 0, 100% 0, 100% 35%, 75% 35%, 75% 70%, 55% 70%, 55% 100%, 40% 100%, 40% 70%, 20% 70%, 20% 35%, 0 35%);
        box-shadow: none;
        filter: drop-shadow(2px 2px 0 rgba(108, 91, 210, .22));
      }

      :host([theme="healing"][style-name="pixel"]) {
        --bubble-ink: #5c335d;
        --bubble-hot: #ef5aa5;
        --bubble-paw: #ed62aa;
        --bubble-accent: #ed5ca8;
      }

      :host([theme="healing"][style-name="pixel"]) .frame { background: #dc4c9a; box-shadow: 5px 6px 0 rgba(211, 78, 151, .2), 0 0 12px rgba(244, 91, 175, .26); }
      :host([theme="healing"][style-name="pixel"]) .frame::before { background: linear-gradient(rgba(255, 220, 239, .22) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 220, 239, .22) 1px, transparent 1px), linear-gradient(150deg, #fffdfa, #fff2f8 66%, #ffeaf5); background-size: 4px 4px, 4px 4px, auto; }
      :host([theme="healing"][style-name="pixel"]) .label { border-color: transparent; background: #e0529f; color: #fff; box-shadow: 4px 4px 0 rgba(201, 63, 139, .2), inset 0 0 0 2px rgba(255, 255, 255, .3); }
      :host([theme="healing"][style-name="pixel"]) .tail { background: #fff0f7; box-shadow: none; filter: drop-shadow(2px 2px 0 rgba(211, 70, 149, .2)); }

      /* 科幻气泡：切角外框、HUD 线段和右侧状态文案。 */
      :host([style-name="sci-fi"]) {
        --bubble-width: 278px;
        min-height: 82px;
        padding: 25px 50px 15px 27px;
        color: #2f4387;
      }

      :host([style-name="sci-fi"]) .frame {
        overflow: visible;
        border: 0;
        border-radius: 0;
        background: linear-gradient(115deg, #8476ff, #69cfff 48%, #a688ff 76%, #6ae5ff);
        box-shadow: 0 0 0 1px rgba(184, 224, 255, .42), 0 0 17px rgba(67, 187, 255, .48), 0 0 24px rgba(139, 103, 255, .38);
        clip-path: polygon(13px 0, calc(100% - 13px) 0, calc(100% - 13px) 4px, calc(100% - 5px) 4px, calc(100% - 5px) 12px, 100% 12px, 100% calc(100% - 12px), calc(100% - 6px) calc(100% - 12px), calc(100% - 6px) calc(100% - 5px), calc(100% - 14px) calc(100% - 5px), calc(100% - 14px) 100%, 14px 100%, 14px calc(100% - 5px), 6px calc(100% - 5px), 6px calc(100% - 12px), 0 calc(100% - 12px), 0 13px, 6px 13px, 6px 6px, 13px 6px);
      }

      :host([style-name="sci-fi"]) .frame::before {
        inset: 3px;
        border: 0;
        border-radius: 0;
        background: linear-gradient(145deg, rgba(255, 255, 255, .98), rgba(232, 240, 255, .96) 58%, rgba(223, 235, 255, .96));
        clip-path: polygon(12px 0, calc(100% - 12px) 0, calc(100% - 12px) 4px, calc(100% - 4px) 4px, calc(100% - 4px) 12px, 100% 12px, 100% calc(100% - 12px), calc(100% - 5px) calc(100% - 12px), calc(100% - 5px) calc(100% - 5px), calc(100% - 13px) calc(100% - 5px), calc(100% - 13px) 100%, 13px 100%, 13px calc(100% - 5px), 5px calc(100% - 5px), 5px calc(100% - 12px), 0 calc(100% - 12px), 0 12px, 5px 12px, 5px 5px, 12px 5px);
        content: "";
      }

      :host([style-name="sci-fi"]) .frame::after { top: -24px; left: 26px; width: 180px; background: rgba(255, 255, 255, .66); }
      :host([style-name="sci-fi"]) .label {
        top: -11px;
        left: 18px;
        height: 29px;
        border-color: rgba(205, 224, 255, .72);
        border-radius: 15px 8px 15px 10px;
        background: linear-gradient(140deg, #9a7aff, #625de1 70%);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .42), 0 0 14px rgba(110, 105, 255, .62);
        transform: none;
      }

      :host([style-name="sci-fi"]) .label-text,
      :host([style-name="sci-fi"]) .label-heart,
      :host([style-name="sci-fi"]) .label-paw { transform: none; }
      :host([style-name="sci-fi"]) .sparkle-top { top: -7px; right: 1px; font-size: 15px; }
      :host([style-name="sci-fi"]) .sparkle-bottom { bottom: -3px; left: 10px; }
      :host([style-name="sci-fi"]) :is(.sparkle-top, .sparkle-bottom) { display: none; }
      :host([style-name="sci-fi"]) .paw-primary { top: 21px; right: 18px; width: 21px; height: 18px; opacity: .9; }
      :host([style-name="sci-fi"]) .paw-secondary { display: none; }
      :host([style-name="sci-fi"]) .heart { right: 20px; bottom: 13px; display: block; color: #b691ff; }
      :host([style-name="sci-fi"]) .caret,
      :host([style-name="sci-fi"]) .petal { display: none; }
      :host([style-name="sci-fi"]) .hud { position: absolute; z-index: 4; display: block; height: 2px; background: linear-gradient(90deg, transparent, #7ee8ff, #ae83ff); box-shadow: 0 0 6px rgba(95, 211, 255, .72); }
      :host([style-name="sci-fi"]) .hud-top { top: 7px; right: 44px; width: 42px; }
      :host([style-name="sci-fi"]) .hud-bottom { right: 9px; bottom: 6px; width: 40px; }
      :host([style-name="sci-fi"]) .hud-copy { position: absolute; z-index: 4; top: 22px; right: 13px; display: block; color: rgba(124, 214, 255, .82); font: 6px/1.35 "Microsoft YaHei UI", sans-serif; letter-spacing: .08em; text-align: right; }
      :host([style-name="sci-fi"]) .hud-status { position: absolute; z-index: 4; right: 48px; bottom: 9px; display: block; color: rgba(154, 164, 255, .9); font: 6px/1 "Microsoft YaHei UI", sans-serif; letter-spacing: .1em; }
      :host([style-name="sci-fi"]) .tail { bottom: -11px; border: 0; background: linear-gradient(135deg, #e9f7ff, #9d8bff); box-shadow: none; filter: drop-shadow(0 0 6px rgba(100, 193, 255, .62)); }

      :host([theme="healing"][style-name="sci-fi"]) {
        --bubble-ink: #5f385d;
        --bubble-paw: #ed67ad;
        --bubble-accent: #ef68ae;
        color: var(--bubble-ink);
      }

      :host([theme="healing"][style-name="sci-fi"]) .frame {
        background: linear-gradient(115deg, #ff9bd2, #f0adff 44%, #9ccfff 78%, #ff92ca);
        box-shadow: 0 0 0 1px rgba(255, 219, 241, .6), 0 0 17px rgba(246, 105, 184, .48), 0 0 24px rgba(164, 141, 255, .34);
      }

      :host([theme="healing"][style-name="sci-fi"]) .frame::before {
        background: linear-gradient(145deg, rgba(255, 255, 255, .98), rgba(255, 238, 248, .97) 60%, rgba(244, 240, 255, .96));
      }

      :host([theme="healing"][style-name="sci-fi"]) .label {
        border-color: rgba(255, 155, 210, .8);
        background: linear-gradient(140deg, #fff9fc, #ffdced 72%);
        box-shadow: inset 0 1px 0 #fff, 0 0 14px rgba(244, 92, 174, .45);
        color: #e84e9e;
      }

      :host([theme="healing"][style-name="sci-fi"]) .label-paw { --paw-color: #eb62aa; }
      :host([theme="healing"][style-name="sci-fi"]) .hud { background: linear-gradient(90deg, transparent, #f269b3, #9b9aff); box-shadow: 0 0 6px rgba(244, 104, 180, .62); }
      :host([theme="healing"][style-name="sci-fi"]) .hud-copy { color: rgba(230, 91, 164, .75); }
      :host([theme="healing"][style-name="sci-fi"]) .hud-status { color: rgba(167, 111, 194, .78); }
      :host([theme="healing"][style-name="sci-fi"]) .tail { background: linear-gradient(135deg, #fff6fb, #ee9fd0); box-shadow: none; filter: drop-shadow(0 0 6px rgba(240, 100, 176, .55)); }

      /* 设置页大预览按原稿使用短左向尾巴；主窗口仍使用 .tail。 */
      .tail-left {
        position: absolute;
        z-index: 3;
        top: 50%;
        left: -15px;
        display: none;
        width: 20px;
        height: 24px;
        overflow: visible;
        filter: drop-shadow(-1px 1px 2px var(--bubble-tail-shadow));
        pointer-events: none;
        transform: translateY(-50%);
      }

      .tail-left-fill { fill: var(--bubble-tail-surface); }
      .tail-left-edge {
        fill: none;
        stroke: var(--bubble-outline);
        stroke-linejoin: miter;
        stroke-width: 2;
      }

      .tail-left-smooth,
      .tail-left-pixel,
      .tail-left-sci-fi { display: none; }

      :host([tail-side="left"]) .tail { display: none; }
      :host([tail-side="left"]) .tail-left { display: block; }
      :host([tail-side="left"]) .tail-left-smooth { display: block; }

      :host([tail-side="left"][style-name="pixel"]) .tail-left {
        filter: drop-shadow(2px 3px 0 rgba(83, 67, 181, .22));
      }

      :host([tail-side="left"][style-name="pixel"]) .tail-left-smooth { display: none; }
      :host([tail-side="left"][style-name="pixel"]) .tail-left-pixel { display: block; }
      :host([tail-side="left"][style-name="pixel"]) .tail-left-fill { fill: #f1efff; }
      :host([tail-side="left"][style-name="pixel"]) .tail-left-edge { stroke: #6754dc; }

      :host([tail-side="left"][style-name="sci-fi"]) .tail-left-smooth { display: none; }
      :host([tail-side="left"][style-name="sci-fi"]) .tail-left-sci-fi { display: block; }
      :host([tail-side="left"][style-name="sci-fi"]) .tail-left-edge { stroke: #8476ff; }
      :host([tail-side="left"][style-name="sci-fi"]) .tail-left-fill { fill: #eef5ff; }

      :host([theme="healing"][tail-side="left"][style-name="pixel"]) .tail-left {
        filter: drop-shadow(2px 3px 0 rgba(174, 48, 117, .18));
      }

      :host([theme="healing"][tail-side="left"][style-name="pixel"]) .tail-left-fill { fill: #fff0f7; }
      :host([theme="healing"][tail-side="left"][style-name="pixel"]) .tail-left-edge { stroke: #d44291; }
      :host([theme="healing"][tail-side="left"][style-name="sci-fi"]) .tail-left-edge { stroke: #ef70b5; }
      :host([theme="healing"][tail-side="left"][style-name="sci-fi"]) .tail-left-fill { fill: #fff2f8; }

      @media (prefers-reduced-motion: reduce) {
        :host(.interaction-bubble-widget),
        .message-expand { transition: none; }
      }
    </style>
    <span class="frame" aria-hidden="true"></span>
    <span class="label" aria-hidden="true">
      <i class="paw label-paw"></i>
      <strong class="label-text"></strong>
      <i class="label-heart">♥</i>
    </span>
    <span class="source-marker" aria-label="消息来源：外部消息" title="外部消息" hidden>外部</span>
    <i class="decor sparkle sparkle-top" aria-hidden="true">✦</i>
    <i class="decor sparkle sparkle-bottom" aria-hidden="true">✦</i>
    <i class="decor paw paw-primary" aria-hidden="true"></i>
    <i class="decor paw paw-secondary" aria-hidden="true"></i>
    <i class="decor heart" aria-hidden="true">♥</i>
    <i class="decor heart-secondary" aria-hidden="true">♥</i>
    <i class="decor caret" aria-hidden="true"></i>
    <i class="decor petal petal-left" aria-hidden="true"></i>
    <i class="decor petal petal-right" aria-hidden="true"></i>
    <i class="decor ribbon" aria-hidden="true"></i>
    <i class="hud hud-top" aria-hidden="true"></i>
    <i class="hud hud-bottom" aria-hidden="true"></i>
    <span class="hud-copy" aria-hidden="true">KITSUNE<br>WITH YOU</span>
    <span class="hud-status" aria-hidden="true">••• GOOD DAY</span>
    <span class="message" aria-live="polite"></span>
    <button class="message-expand" type="button" aria-expanded="false" aria-label="展开全文" hidden>展开全文</button>
    <i class="tail" aria-hidden="true"></i>
    <svg class="tail-left" viewBox="0 0 24 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g class="tail-left-smooth">
        <path class="tail-left-fill" d="M24 4L1 12L24 20Z"></path>
        <path class="tail-left-edge" d="M24 4L1 12L24 20"></path>
      </g>
      <g class="tail-left-pixel" shape-rendering="crispEdges">
        <path class="tail-left-fill" d="M24 3H19V6H14V9H8V11H2V13H8V15H14V18H19V21H24Z"></path>
        <path class="tail-left-edge" d="M24 3H19V6H14V9H8V11H2V13H8V15H14V18H19V21H24"></path>
      </g>
      <g class="tail-left-sci-fi">
        <path class="tail-left-fill" d="M24 3L0 12L24 21Z"></path>
        <path class="tail-left-edge" d="M24 3L0 12L24 21"></path>
      </g>
    </svg>
  `

  const styleWidths = Object.freeze({ glass: 270, sweet: 264, pixel: 270, 'sci-fi': 278 })

  class PetSpeechBubble extends HTMLElement {
    static get observedAttributes() { return ['label', 'message', 'source', 'style-name', 'theme', 'expanded'] }

    constructor() {
      super()
      this.attachShadow({ mode: 'open' }).appendChild(template.content.cloneNode(true))
      this.labelElement = this.shadowRoot.querySelector('.label-text')
      this.sourceElement = this.shadowRoot.querySelector('.source-marker')
      this.messageElement = this.shadowRoot.querySelector('.message')
      this.expandButton = this.shadowRoot.querySelector('.message-expand')
      this.overflowMeasureFrame = null
      this.resizeObserver = null

      // The host intentionally stays click-through so the speech bubble does not
      // turn into a large drag blocker. Only this explicit control receives input.
      this.expandButton.addEventListener('pointerdown', event => event.stopPropagation())
      this.expandButton.addEventListener('mousedown', event => event.stopPropagation())
      this.expandButton.addEventListener('click', event => {
        event.stopPropagation()
        if (!this.expandable) return
        this.dispatchEvent(new CustomEvent('bubble-expand', {
          bubbles: true,
          composed: true,
          detail: {
            text: this.message,
            label: this.label,
            source: this.source,
          },
        }))
      })
    }

    connectedCallback() {
      if (!this.hasAttribute('theme')) this.setAttribute('theme', 'glass')
      if (!this.hasAttribute('style-name')) this.setAttribute('style-name', 'glass')
      this.syncContent()
      if (typeof ResizeObserver === 'function') {
        if (!this.resizeObserver) {
          this.resizeObserver = new ResizeObserver(() => this.scheduleOverflowMeasure())
        }
        this.resizeObserver.observe(this)
      }
      this.scheduleOverflowMeasure()
    }

    disconnectedCallback() {
      if (this.resizeObserver) this.resizeObserver.disconnect()
      if (this.overflowMeasureFrame != null) cancelAnimationFrame(this.overflowMeasureFrame)
      this.overflowMeasureFrame = null
    }

    attributeChangedCallback(name) {
      if (name === 'expanded') {
        this.syncExpandedState()
        return
      }
      this.syncContent()
    }

    syncContent() {
      if (!this.labelElement || !this.sourceElement || !this.messageElement) return
      const label = this.getAttribute('label') || '伙伴'
      const message = this.getAttribute('message') || ''
      if (this.labelElement.textContent !== label) this.labelElement.textContent = label
      this.sourceElement.hidden = this.source !== 'external'
      if (this.messageElement.textContent !== message) this.messageElement.textContent = message
      this.scheduleOverflowMeasure()
    }

    scheduleOverflowMeasure() {
      if (!this.isConnected) return
      if (this.overflowMeasureFrame != null) cancelAnimationFrame(this.overflowMeasureFrame)
      this.overflowMeasureFrame = requestAnimationFrame(() => {
        this.overflowMeasureFrame = null
        this.measureOverflow()
      })
    }

    measureOverflow() {
      if (!this.messageElement || !this.expandButton) return false
      const hasMessage = this.messageElement.textContent.trim().length > 0
      const overflowing = hasMessage && this.messageElement.scrollHeight > this.messageElement.clientHeight + 1
      this.toggleAttribute('expandable', overflowing)
      this.expandButton.hidden = !overflowing
      if (!overflowing && this.expanded) this.removeAttribute('expanded')
      this.syncExpandedState()
      return overflowing
    }

    syncExpandedState() {
      if (!this.expandButton) return
      this.expandButton.setAttribute('aria-expanded', String(this.expandable && this.expanded))
    }

    get message() { return this.messageElement.textContent }
    set message(value) { this.setAttribute('message', String(value || '')) }
    get label() { return this.labelElement.textContent }
    set label(value) { this.setAttribute('label', String(value || '')) }
    get source() { return this.getAttribute('source') === 'external' ? 'external' : '' }
    set source(value) {
      if (value === 'external') this.setAttribute('source', 'external')
      else this.removeAttribute('source')
    }
    get styleName() { return this.getAttribute('style-name') || 'glass' }
    set styleName(value) { this.setAttribute('style-name', String(value || 'glass')) }
    get expandable() { return this.hasAttribute('expandable') }
    get expanded() { return this.hasAttribute('expanded') }
    set expanded(value) { this.toggleAttribute('expanded', Boolean(value)) }
    get preferredWidth() { return styleWidths[this.styleName] || styleWidths.glass }
    get visualOverflow() { return this.styleName === 'sweet' || this.styleName === 'sci-fi' ? 24 : 18 }

    setTailX(value) {
      const x = Number(value)
      if (Number.isFinite(x)) this.style.setProperty('--bubble-tail-x', `${x}px`)
    }
  }

  if (!customElements.get('pet-speech-bubble')) customElements.define('pet-speech-bubble', PetSpeechBubble)
})()
