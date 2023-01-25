import {PeerId} from "@libp2p/interface-peer-id";
import {IBeaconConfig} from "@lodestar/config";
import {eip4844, Epoch, phase0} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";

import {BlockInput, getBlockInput} from "../../chain/blocks/types.js";
import {getEmptyBlobsSidecar} from "../../util/blobs.js";
import {IReqRespBeaconNode} from "./interface.js";

export async function beaconBlocksMaybeBlobsByRange(
  config: IBeaconConfig,
  reqResp: IReqRespBeaconNode,
  peerId: PeerId,
  request: phase0.BeaconBlocksByRangeRequest,
  currentEpoch: Epoch
): Promise<BlockInput[]> {
  // Code below assumes the request is in the same epoch
  // Range sync satisfies this condition, but double check here for sanity
  const startEpoch = computeEpochAtSlot(request.startSlot);
  const endEpoch = computeEpochAtSlot(request.startSlot + request.count);
  if (startEpoch !== endEpoch) {
    throw Error(`BeaconBlocksByRangeRequest must be in the same epoch ${startEpoch} != ${endEpoch}`);
  }

  // Note: Assumes all blocks in the same epoch
  if (config.getForkSeq(request.startSlot) < ForkSeq.eip4844) {
    const blocks = await reqResp.beaconBlocksByRange(peerId, request);
    return blocks.map((block) => getBlockInput.preEIP4844(config, block));
  }

  // Only request blobs if they are recent enough
  else if (computeEpochAtSlot(request.startSlot) >= currentEpoch - config.MIN_EPOCHS_FOR_BLOBS_SIDECARS_REQUESTS) {
    const [blocks, blobsSidecars] = await Promise.all([
      reqResp.beaconBlocksByRange(peerId, request),
      reqResp.blobsSidecarsByRange(peerId, request),
    ]);

    const blockInputs: BlockInput[] = [];
    let blobSideCarIndex = 0;
    let lastMatchedSlot = -1;

    // Match blobSideCar with the block as some blocks would have no blobs and hence
    // would be omitted from the response. If there are any inconsitencies in the
    // response, the validations during import will reject the block and hence this
    // entire segment.
    //
    // Assuming that the blocks and blobs will come in same sorted order
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      let blobsSidecar: eip4844.BlobsSidecar;

      if (blobsSidecars[blobSideCarIndex]?.beaconBlockSlot === block.message.slot) {
        blobsSidecar = blobsSidecars[blobSideCarIndex];
        lastMatchedSlot = block.message.slot;
        blobSideCarIndex++;
      } else {
        // Quick inspect if the blobsSidecar was expected
        const blobKzgCommitmentsLen = (block.message.body as eip4844.BeaconBlockBody).blobKzgCommitments.length;
        if (blobKzgCommitmentsLen !== 0) {
          throw Error(
            `Missing blobsSidecar for blockSlot=${block.message.slot} with blobKzgCommitmentsLen=${blobKzgCommitmentsLen}`
          );
        }
        blobsSidecar = getEmptyBlobsSidecar(config, block as eip4844.SignedBeaconBlock);
      }
      blockInputs.push(getBlockInput.postEIP4844(config, block, blobsSidecar));
    }

    // If there are still unconsumed blobs this means that the response was inconsistent
    // and matching was wrong and hence we should throw error
    if (blobsSidecars[blobSideCarIndex] !== undefined) {
      throw Error(
        `Unmatched blobsSidecars, blocks=${blocks.length}, blobs=${
          blobsSidecars.length
        } lastMatchedSlot=${lastMatchedSlot}, pending blobsSidecars slots=${blobsSidecars
          .slice(blobSideCarIndex)
          .map((blb) => blb.beaconBlockSlot)}`
      );
    }
    return blockInputs;
  }

  // Post EIP-4844 but old blobs
  else {
    throw Error("Cannot sync blobs outside of blobs prune window");
  }
}
