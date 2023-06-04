import { ethers } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';

interface Vars {}

const STMATIC = "0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4"
const STMATIC_PRICE_FEED = "0x97371dF4492605486e23Da797fA68e55Fc38a13f"

export default migration('1685810982_add_stmatic_collateral', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    vars: Vars
  ) => {
    const trace = govDeploymentManager.tracer();
    const { bridgeReceiver } = await deploymentManager.getContracts();

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      fxRoot
    } = await govDeploymentManager.getContracts();

    const newAssetConfig = {
      asset: STMATIC,
      priceFeed: STMATIC_PRICE_FEED,
      decimals: 18,
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(10000000, 18)
    };

    const addAssetConfigCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', '(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [
        comet.address,
        [
          newAssetConfig.asset,
          newAssetConfig.priceFeed,
          newAssetConfig.decimals,
          newAssetConfig.borrowCollateralFactor,
          newAssetConfig.liquidateCollateralFactor,
          newAssetConfig.liquidationFactor,
          newAssetConfig.supplyCap
        ]
      ]
    );

    const deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)'
        ],
        [addAssetConfigCalldata, deployAndUpgradeToCalldata]
      ]
    );

    const actions = [
      // 1. add stMATIC asset and deployAndUpgradeTo new Comet on Polygon.
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [bridgeReceiver.address, l2ProposalData]
      }
    ];

    const description = '# Add stMATIC as Collateral to cUSDCv3 Polygon\nThis proposal adds stMATIC as collateral.\n';
    const txn = await govDeploymentManager.retry(async () =>
      governor.propose(...(await proposal(actions, description))), 0
    );
    trace(txn);

    const event = (await txn.wait()).events.find(event => event.event === 'ProposalCreated');

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
    console.log(`Created proposal ${proposalId}.`);
  },
});
