import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { ethers, exp } from '../test/helpers';
import { createCrossChainProposal, isBridgedDeployment, matchesDeployment } from './utils';
import { BaseBridgeReceiver } from '../build/types';

const STMATIC = "0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4"
const STMATIC_PRICE_FEED = "0x97371dF4492605486e23Da797fA68e55Fc38a13f"

// This is a Polygon-specific scenario that tests the governance contract upgrade flow
scenario.only('add stmatic asset',
  {
    filter: async ctx => matchesDeployment(ctx, [{network: 'polygon'}])
  },
  async ({ comet, configurator, proxyAdmin, bridgeReceiver: oldBridgeReceiver }, context, world) => {
    const dm = world.deploymentManager;
    const govDeploymentManager = world.auxiliaryDeploymentManager!;
    const fxChild = await dm.getContractOrThrow('fxChild');

    // Deploy new PolygonBridgeReceiver
    const newBridgeReceiver = await dm.deploy<BaseBridgeReceiver, [string]>(
      'newBridgeReceiver',
      'bridges/polygon/PolygonBridgeReceiver.sol',
      [fxChild.address]           // fxChild
    );

    // Deploy new local Timelock
    const secondsPerDay = 24 * 60 * 60;
    const newLocalTimelock = await dm.deploy(
      'newTimelock',
      'vendor/Timelock.sol',
      [
        newBridgeReceiver.address, // admin
        2 * secondsPerDay,         // delay
        14 * secondsPerDay,        // grace period
        2 * secondsPerDay,         // minimum delay
        30 * secondsPerDay         // maxiumum delay
      ]
    );

    // Initialize new PolygonBridgeReceiver
    const mainnetTimelock = (await govDeploymentManager.getContractOrThrow('timelock')).address;
    await newBridgeReceiver.initialize(
      mainnetTimelock,             // govTimelock
      newLocalTimelock.address     // localTimelock
    );
    
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
        [configurator.address, proxyAdmin.address],
        [0, 0],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)'
        ],
        [addAssetConfigCalldata, deployAndUpgradeToCalldata]
      ]
    );
    
    await createCrossChainProposal(context, l2ProposalData, oldBridgeReceiver);
    
    const res = await comet.getAssetInfoByAddress(STMATIC)
    expect(res.asset).to.eq(STMATIC)
    expect(res.priceFeed).to.eq(newAssetConfig.priceFeed)
    expect(res.borrowCollateralFactor).to.eq(newAssetConfig.borrowCollateralFactor)
    expect(res.liquidateCollateralFactor).to.eq(newAssetConfig.liquidateCollateralFactor)
    expect(res.liquidationFactor).to.eq(newAssetConfig.liquidationFactor)
    expect(res.supplyCap).to.eq(newAssetConfig.supplyCap)
  }
);
