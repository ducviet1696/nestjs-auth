import {UseGuards} from '@nestjs/common';
import {Args, Mutation, Parent, Query, ResolveProperty, Resolver, Subscription} from '@nestjs/graphql';
import {PubSub} from 'graphql-subscriptions';
import {GetAVMDetailInput, Home, ModelHomeFilterInput} from '../graphql.schema';
import {HomeService} from './home.service';
import {CreateHomeDto, DeleteHomeDto, UpdateHomeDto} from './dto';
import {AttomDataApiService} from './attom-data-api.service';
import {GraphqlGuard} from '../_helpers';
import {User as CurrentUser} from '../_helpers/graphql/user.decorator';
import {UserEntity as User} from '../user/entity/user.entity';
import {UserService} from '../user/user.service';
import {HomeEntity} from './entity';
import {HomeMediaService} from '../home-media/home-media.service';
import {HomeMediaEntity} from '../home-media/entity';
import {HomeFavoriteService} from '../home-favorite/home-favorite.service';
import {AppLogger} from '../app.logger';
import {Client, ClientProxy, Transport} from '@nestjs/microservices';
import {USER_CMD_REGISTER} from '../user';
import {HOME_CMD_DELETE} from './home.constants';

@Resolver('Home')
export class HomeResolver {

	@Client({ transport: Transport.TCP })
	private client: ClientProxy;
	private pubSub = new PubSub();
	private logger = new AppLogger(HomeResolver.name);

	constructor(private readonly homeService: HomeService,
							private readonly attomDataService: AttomDataApiService,
							private readonly userService: UserService,
							private readonly homeMediaService: HomeMediaService,
							private readonly homeFavoriteService: HomeFavoriteService) {
	}

	@Query('getAVMDetail')
	async getDetail(@Args('getAVMDetailInput') args: GetAVMDetailInput) {
		const schoolsDetails = [];

		const locationResponse = await this.attomDataService.getLocation({address: `${args.address_1} ${args.address_2}`});
		const avmDetailsResponse = await this.attomDataService.getAVMDetail({address1: args.address_1, address2: args.address_2});
		const property = avmDetailsResponse.data.property[0];
		if (locationResponse.data.results.length) {
			const location = locationResponse.data.results[0].geometry.location;
			property.location.latitude = location.lat;
			property.location.longitude = location.lng;
		}
		const propertyId = property.identifier.obPropId;
		const detailWithSchoolsResponse = await this.attomDataService.getDetailWithSchools({id: propertyId});
		const schools = detailWithSchoolsResponse.data.property[0].school;
		for (const school of schools) {
			const schoolDetailResponse = await this.attomDataService.getSchoolDetail({id: school.OBInstID});
			schoolsDetails.push(schoolDetailResponse.data.school[0]);
		}

		return {
			property: property,
			schools: schoolsDetails
		};
	}

	@Query('listHomes')
	async findAll(@Args('filter') filter?: ModelHomeFilterInput, @Args('limit') limit?: number): Promise<HomeEntity[]> {
		return this.homeService.findAll({filter, limit});
	}

	@Query('myHomes')
	@UseGuards(GraphqlGuard)
	async findAllMyHomes(@CurrentUser() user: User): Promise<HomeEntity[]> {
		return this.homeService.findAll({filter: {owner: {eq: user.id}}});
	}

	@Query('getHome')
	async findOneById(@Args('id') id: string): Promise<HomeEntity> {
		return await this.homeService.findOneById(id);
	}

	@Mutation('createHome')
	@UseGuards(GraphqlGuard)
	async create(@CurrentUser() user: User, @Args('createHomeInput') args: CreateHomeDto): Promise<HomeEntity> {
		const createdHome = await this.homeService.create({
			owner: user.id,
			...args
		});
		await this.pubSub.publish('homeCreated', {homeCreated: createdHome});
		return createdHome;
	}

	@Mutation('deleteHome')
	@UseGuards(GraphqlGuard)
	async delete(@CurrentUser() user: User, @Args('deleteHomeInput') args: DeleteHomeDto): Promise<HomeEntity> {
		const deletedHome = await this.homeService.delete(args.id);
		this.client.send({cmd: HOME_CMD_DELETE}, deletedHome).subscribe();
		await this.pubSub.publish('homeDeleted', {homeDeleted: deletedHome});
		return deletedHome;
	}

	@Mutation('updateHome')
	@UseGuards(GraphqlGuard)
	async update(@Args('updateHomeInput') args: UpdateHomeDto): Promise<HomeEntity> {
		const updatedHome = await this.homeService.update(args);
		await this.pubSub.publish('homeUpdated', {homeUpdated: updatedHome});
		return updatedHome;
	}

	@Subscription('homeCreated')
	homeCreated() {
		return {
			subscribe: () => this.pubSub.asyncIterator('homeCreated')
		};
	}

	@Subscription('homeDeleted')
	homeDeleted() {
		return {
			subscribe: () => this.pubSub.asyncIterator('homeDeleted')
		};
	}

	@Subscription('homeUpdated')
	homeUpdated() {
		return {
			subscribe: () => this.pubSub.asyncIterator('homeUpdated')
		};
	}

	@ResolveProperty('owner')
	async getOwner(@Parent() home: HomeEntity): Promise<Home> {
		try {
			return this.userService.findOneById(home.owner);
		} catch (e) {
			return this.userService.create({});
		}
	}

	@ResolveProperty('media')
	async getMedia(@Parent() home: HomeEntity): Promise<HomeMediaEntity[]> {
		return this.homeMediaService.findAll({filter: {homeId: {eq: home.id}}});
	}

	@ResolveProperty('favorite')
	@UseGuards(GraphqlGuard)
	async getFavorite(@CurrentUser() user: User, @Parent() home: HomeEntity): Promise<Boolean> {
		const homeFavorites = await this.homeFavoriteService.findAll({
			filter: {
				homeFavoriteUserId: {eq: user.id},
				homeFavoriteHomeId: {eq: home.id}
			}
		});
		return !!homeFavorites.length;
	}
}
