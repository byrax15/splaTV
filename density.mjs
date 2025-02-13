import { vec3 } from './vector.mjs';

export class Space {
    /**
     * 
     * @param {number[]} min 
     * @param {number[]} max 
     */
    constructor(min, max) {
        this.min = min
        this.max = max
    }

    get size() { return this.min.map((k, i) => this.max[i] - k) }
    get volume() { return this.size.reduce((a, b) => a * b, 1) }
    set scale(factor) {
        [this.min, this.max].forEach(d => d.forEach((k, i) => d[i] = k * factor))
    }

    /**
     * 
     * @param {number} vertexCount 
     * @param {Float32Array | number[]} positions 
     * @returns 
     */
    setMinMax(vertexCount, positions) {
        this.min = [Infinity, Infinity, Infinity];
        this.max = [-Infinity, -Infinity, -Infinity];
        for (let i = vertexCount; i-- > 0;) {
            const p = positions.slice(3 * i, 3 * i + 3);
            this.min.forEach((k, i) => this.min[i] = Math.min(k, p[i]));
            this.max.forEach((k, i) => this.max[i] = Math.max(k, p[i]));
        }
    }

    static from(space) {
        const self = new Space;
        self.min = space.min;
        self.max = space.max;
        return self;
    }
}

export class Voxel {
    space
    numGaussians = 0

    constructor(space) {
        this.space = space
    }

    get density() { return this.numGaussians/*  / this.space.volume */ }

    static from(voxel) {
        const self = new Voxel;
        self.space = Space.from(voxel.space);
        self.numGaussians = voxel.numGaussians;
        return self;
    }
}

export class HashGrid {
    static numberVoxel = [32,32,32]
    static get voxelVolume() { return HashGrid.numberVoxel.reduce((a, b) => a * b, 1); }

    /** @type {Space}*/ space = new Space([0, 0, 0], [0, 0, 0]);
    density = { min: Infinity, max: -Infinity }
    /** @type {Voxel[][][]}*/ voxels

    get voxelSize() { return this.space.size.map((k, i) => k / HashGrid.numberVoxel[i]) }

    static from({ space, density, voxels }) {
        const self = new HashGrid;
        self.space = Space.from(space);
        self.density = density;
        self.resizeVoxels(voxels);
        return self;
    }

    countGaussians(vertexCount, positions) {
        this.density = { min: Infinity, max: -Infinity };

        for (let i = vertexCount; i-- > 0;) {
            const p = positions.slice(3 * i, 3 * i + 3);
            const voxel = this.findVoxel(p);
            ++voxel.numGaussians;
            this.density.min = Math.min(this.density.min, voxel.density);
            this.density.max = Math.max(this.density.max, voxel.density);
        }
        return this;
    }

    findVoxelIndex(position) {
        return position.map((k, i) => Math.floor((k - this.space.min[i]) * HashGrid.numberVoxel[i] / (this.space.max[i] - this.space.min[i])))
    }

    findVoxel(position) {
        const [i, j, k] = this.findVoxelIndex(position);
        return this.voxels[i][j][k];
    }

    resizeVoxels(old) {
        const [x, y, z] = HashGrid.numberVoxel;
        if (old) {
            this.voxels = new Array(x);
            for (let i = 0; i < x; i++) {
                this.voxels[i] = new Array(y);
                for (let j = 0; j < y; j++) {
                    this.voxels[i][j] = new Array(z);
                    for (let k = 0; k < z; k++) {
                        this.voxels[i][j][k] = Voxel.from(old[i][j][k]);
                    }
                }
            }
        } else {
            this.voxels = new Array(x);
            for (let i = 0; i < x; i++) {
                this.voxels[i] = new Array(y);
                for (let j = 0; j < y; j++) {
                    this.voxels[i][j] = new Array(z);
                    for (let k = 0; k < z; k++) {
                        this.voxels[i][j][k] = new Voxel(new Space(
                            this.space.min.map((min, dim) => min + [i, j, k][dim] * this.voxelSize[dim]),
                            this.space.max.map((max, dim) => this.space.min[dim] + ([i, j, k][dim] + 1) * this.voxelSize[dim])
                        ));
                    }
                }
            }
        }
    }
}