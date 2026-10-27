/** Exact, deterministic 3-D KD-tree with (distance, original index) nearest-neighbour ordering. */
export interface Neighbor {
  index: number;
  distanceSquared: number;
}
interface Node {
  point: number;
  axis: number;
  left: number;
  right: number;
}
export class KDTree {
  private readonly nodes: Node[] = [];
  constructor(
    private readonly positions: Float32Array,
    private readonly count: number,
  ) {
    const ids = Uint32Array.from({ length: count }, (_, i) => i);
    this.build(ids, 0);
  }
  private build(ids: Uint32Array, depth: number): number {
    if (ids.length === 0) return -1;
    const axis = depth % 3;
    const sorted = [...ids].sort(
      (a, b) => this.positions[a * 3 + axis]! - this.positions[b * 3 + axis]! || a - b,
    );
    const middle = Math.floor(sorted.length / 2);
    const point = sorted[middle]!;
    const index = this.nodes.length;
    this.nodes.push({ point, axis, left: -1, right: -1 });
    const node = this.nodes[index]!;
    node.left = this.build(Uint32Array.from(sorted.slice(0, middle)), depth + 1);
    node.right = this.build(Uint32Array.from(sorted.slice(middle + 1)), depth + 1);
    return index;
  }
  nearest(pointIndex: number, requested: number): Neighbor[] {
    const k = Math.min(Math.max(1, requested), this.count);
    const best: Neighbor[] = [];
    const distance = (a: number, b: number): number => {
      let result = 0;
      for (let c = 0; c < 3; c += 1)
        result += (this.positions[a * 3 + c]! - this.positions[b * 3 + c]!) ** 2;
      return result;
    };
    const visit = (nodeIndex: number): void => {
      if (nodeIndex < 0) return;
      const node = this.nodes[nodeIndex]!;
      const item = { index: node.point, distanceSquared: distance(pointIndex, node.point) };
      let insert = best.findIndex(
        (n) =>
          item.distanceSquared < n.distanceSquared ||
          (item.distanceSquared === n.distanceSquared && item.index < n.index),
      );
      if (insert < 0) insert = best.length;
      if (insert < k) {
        best.splice(insert, 0, item);
        if (best.length > k) best.pop();
      }
      const delta =
        this.positions[pointIndex * 3 + node.axis]! - this.positions[node.point * 3 + node.axis]!;
      const first = delta <= 0 ? node.left : node.right;
      const second = delta <= 0 ? node.right : node.left;
      visit(first);
      if (best.length < k || delta * delta <= best.at(-1)!.distanceSquared) visit(second);
    };
    visit(0);
    return best;
  }
}
