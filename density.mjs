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
}

export class Voxel {
    space
    numGaussians = 0

    constructor(space) {
        this.space = space
    }

    get density() { return this.numGaussians / this.space.volume }
}

export class HashGrid {
    static numberVoxel = [1, 1, 1].map(k => k * 2)

    /** @type {Space}*/space
    /** @type {Voxel[][][]}*/voxels

    get voxelSize() { return this.space.size.map((k, i) => k / HashGrid.numberVoxel[i]) }
    get voxelVolume() { return this.voxels.length * this.voxels[0].length * this.voxels[0][0].length }

    constructor(space) {
        this.space = space
        this.resizeVoxels()
    }

    findVoxelIndex(position) {
        return position.map((k, i) => Math.floor((k - this.space.min[i]) * (HashGrid.numberVoxel[i]) / (this.space.max[i] - this.space.min[i])))
    }

    findVoxel(position) {
        const [i, j, k] = this.findVoxelIndex(position)
        return this.voxels[i][j][k]
    }

    resizeVoxels() {
        const [x, y, z] = HashGrid.numberVoxel;
        this.voxels = new Array(x);
        for (let i = 0; i < x; i++) {
            this.voxels[i] = new Array(y);
            for (let j = 0; j < y; j++) {
                this.voxels[i][j] = new Array(z);
                for (let k = 0; k < z; k++) {
                    this.voxels[i][j][k] = new Voxel(
                        new Space(
                            this.space.min.map((min, dim) => min + [i, j, k][dim] * this.voxelSize[dim]),
                            this.space.max.map((max, dim) => this.space.min[dim] + ([i, j, k][dim] + 1) * this.voxelSize[dim])
                        )
                    );
                }
            }
        }
    }

    toMessage() {
        return new DensityColor(this);
    }
}

export class DensityColor {
    constructor(hashgrid) {
        this.density = {
            /** @type {number[]} */
            values: new Array(hashgrid.voxelVolume),
            min: Infinity,
            max: -Infinity,
        };
        this.color = {
            /** @type {number[]} */
            values: new Array(hashgrid.voxelVolume),
            min: [300, 1., .1], //hsl
            max: [60., 1., .5], //hsl
        };

        let { density, color } = this
        {
            let flatIndex = 0
            for (let i of hashgrid.voxels) {
                for (let j of i) {
                    for (let k of j) {
                        density.values[flatIndex++] = k.density;
                        density.min = Math.min(density.min, k.density);
                        density.max = Math.max(density.max, k.density);
                    }
                }
            }
        }

        {
            let flatIndex = 0
            for (let i of hashgrid.voxels) {
                for (let j of i) {
                    for (let k of j) {
                        color.values[flatIndex++] = vec3.lerp(
                            vec3.create(),
                            color.min,
                            color.max,
                            (k.density - density.min) / (density.max - density.min)
                        );
                    }
                }
            }
        }
    }
}