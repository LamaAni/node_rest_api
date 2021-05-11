const { GetPodLogs } = require('./queries')

const logs = new GetPodLogs('pod', 'ns', {
    container: 'cont',
})

logs.bind_logger(console)

const req = {},
    res = {}

let data = logs.parse_data_chunk(
    req,
    res,
    `this is some pre text that dose not match
1985-04-12T23:20:50.52Z 1. adsdad asda da
asd asda dsadasd 2. sad
ad asdsad
1985-04-12T23:20:50.52Z 3. 
1996-12-19T16:39:57-08:00 4. asdfsdfsdf
1990-12-31T23:59:60Z 5. 
asdfsdfadf

     
1990-12-31T15:59:60-08:00 6. 
1937-01-01T12:00:27.87+00:20 7.
asddasdadas
1937-01-01T12:00:27.87+00:20 8. This line will pend
since the last ch`,
)
