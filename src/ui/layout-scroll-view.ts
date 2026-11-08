import { ScrollView } from '@earendil-works/pi-tui';

/** Restore a position after Pi has measured the scroll content and viewport. */
export class LayoutScrollView extends ScrollView {
    override primary = true;
    afterNextLayout: (() => void) | undefined;
    beforeGeometryChange: (() => void) | undefined;
    private measuredWidth: number | undefined;
    private laidOutWidth: number | undefined;
    get contentWidth(): number | undefined { return this.laidOutWidth; }
    override getContentWidth(width: number): number {
        const contentWidth = super.getContentWidth(width);
        this.measuredWidth = contentWidth;
        return contentWidth;
    }
    override updateLayout(...args: Parameters<ScrollView['updateLayout']>): void {
        // Pi measures the child before updating the viewport and clamping its row offset.
        if (this.laidOutWidth !== undefined && (this.laidOutWidth !== this.measuredWidth || this.viewportHeight !== args[1]))
            this.beforeGeometryChange?.();
        this.laidOutWidth = this.measuredWidth;
        super.updateLayout(...args);
        const restore = this.afterNextLayout;
        this.afterNextLayout = undefined;
        restore?.();
    }
}
