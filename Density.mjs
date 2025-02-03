export class Space {
    /** @type {number[]} */ min
    /** @type {number[]} */ max
    constructor(min, max) {
        this.min = min;
        this.max = max
    }

    get size() { return this.min.map((k, i) => this.max[i] - k) }
}

export class Voxel {
    space
    numGaussians = 0

    constructor(space) {
        this.space = space
    }

    get size() { return this.min.map((k, i) => this.max[i] - k) }
    get volume() { return this.size.reduce((a, b) => a * b), 1 }
    get density() { return this.numGaussians / this.volume }
}

export class HashGrid {
    static numberVoxel = [1000, 1000, 1000]

    /** @type {Space}*/space
    /** @type {Voxel[][][]}*/voxels

    get voxelSize() { return this.space.size.map((k, i) => k / HashGrid.numberVoxel[i]) }

    constructor(space) {
        this.space = space
        this.resizeVoxels()
    }

    resizeVoxels() {
        this.voxels = new Array(numberVoxel[0])
        for (let i = 0; i < numberVoxel[0]; i++) {
            this.voxels[i] = new Array(numberVoxel[1])
            for (let j = 0; j < numberVoxel[1]; j++) {
                this.voxels[i][j] = new Array(numberVoxel[2])
                for (let k = 0; k < numberVoxel[2]; k++) {
                    this.voxels[i][j][k] = new Voxel(
                        new Space(
                            this.space.min.map((k, i) => k + i * this.voxelSize[i]),
                            this.space.max.map((k, i) => k + (i + 1) * this.voxelSize[i])
                        )
                    )
                }
            }
        }
    }
}
